/**
 * The live hub over a real WebSocket on a random local port. The market and the login
 * are fakes, so this runs without a database.
 */
import { createServer } from 'node:http';
import { connect as tcpConnect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { LIVE_PATH, LOGGED_OUT, MarketHub } from './hub.js';

const ALICE = { id: 1 };
const BOB = { id: 2 };
/** Cookie -> session. Alice is logged in twice: this browser and her phone. */
const SESSIONS = {
  'u=alice': { userId: ALICE.id, sessionId: 'alice-laptop' },
  'u=alice-phone': { userId: ALICE.id, sessionId: 'alice-phone' },
  'u=bob': { userId: BOB.id, sessionId: 'bob-laptop' },
};

let server;
let hub;
let loads;
const sockets = [];

async function start(options = {}) {
  loads = [];
  hub = new MarketHub({
    loadMarket: async (releaseId) => {
      loads.push(releaseId);
      return { releaseId, version: loads.length };
    },
    authenticate: async (cookie) => SESSIONS[cookie] ?? null,
    coalesceMs: 20,
    log: () => {},
    ...options,
  });
  server = createServer();
  hub.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  hub?.close();
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
});

/** Open a connection that collects every message it gets. */
async function connect({ cookie, origin, path = LIVE_PATH, headers: extra = {} } = {}) {
  const { port } = server.address();
  const headers = { ...extra };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  sockets.push(socket);
  socket.received = [];
  socket.on('message', (data) => socket.received.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return socket;
}

const subscribe = (socket, releaseId) =>
  socket.send(JSON.stringify({ type: 'subscribe', releaseId }));

/** Wait until the socket has `count` messages (or fail after a second). */
async function messages(socket, count) {
  const deadline = Date.now() + 1000;
  while (socket.received.length < count) {
    if (Date.now() > deadline)
      throw new Error(`Got ${socket.received.length} of ${count} messages`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return socket.received;
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

describe('subscribing', () => {
  it('sends the market straight away', async () => {
    await start();
    const socket = await connect();
    subscribe(socket, 249504);
    const [message] = await messages(socket, 1);
    expect(message).toEqual({
      type: 'market',
      releaseId: 249504,
      market: { releaseId: 249504, version: 1 },
    });
    expect(hub.watchers(249504)).toBe(1);
  });

  it('sends changes only to tabs watching that pressing', async () => {
    await start();
    const watching = await connect();
    const other = await connect();
    subscribe(watching, 1);
    subscribe(other, 2);
    await messages(watching, 1);
    await messages(other, 1);
    hub.marketChanged(1);
    await messages(watching, 2);
    await settle();
    expect(other.received).toHaveLength(1);
  });

  it('stops sending after unsubscribe and when the tab closes', async () => {
    await start();
    const socket = await connect();
    subscribe(socket, 1);
    await messages(socket, 1);
    socket.send(JSON.stringify({ type: 'unsubscribe', releaseId: 1 }));
    await settle(20);
    expect(hub.watchers(1)).toBe(0);
    hub.marketChanged(1);
    await settle();
    expect(socket.received).toHaveLength(1);

    subscribe(socket, 2);
    await messages(socket, 2);
    socket.close();
    await settle(20);
    expect(hub.watchers(2)).toBe(0);
  });

  it('answers a message it does not understand without dropping the connection', async () => {
    await start();
    const socket = await connect();
    socket.send('not json');
    socket.send(JSON.stringify({ type: 'subscribe', releaseId: 'abc' }));
    socket.send(JSON.stringify({ type: 'buy', releaseId: 1 }));
    const received = await messages(socket, 3);
    expect(received.every((message) => message.type === 'error')).toBe(true);
    subscribe(socket, 1);
    await messages(socket, 4);
  });

  it('limits how many pressings one tab can watch', async () => {
    await start();
    const socket = await connect();
    for (let releaseId = 1; releaseId <= 21; releaseId += 1) subscribe(socket, releaseId);
    const received = await messages(socket, 21);
    expect(received.filter((message) => message.type === 'error')).toHaveLength(1);
    expect(hub.watchers(21)).toBe(0);
  });

  it('closes a connection that floods it with messages', async () => {
    await start({ messagesPerMinute: 5 });
    const socket = await connect();
    const closed = new Promise((resolve) => socket.once('close', resolve));
    for (let i = 0; i < 6; i += 1) subscribe(socket, 1);
    expect(await closed).toBe(1008);
  });
});

describe('sending changes', () => {
  it('sends several changes close together as one update', async () => {
    await start();
    const socket = await connect();
    subscribe(socket, 1);
    await messages(socket, 1);
    hub.marketChanged(1);
    hub.marketChanged(1);
    hub.marketChanged(1);
    await messages(socket, 2);
    await settle();
    expect(socket.received).toHaveLength(2);
    expect(loads).toEqual([1, 1]);
  });

  it('does not load a market nobody is watching', async () => {
    await start();
    hub.marketChanged(99);
    await settle();
    expect(loads).toEqual([]);
  });

  it('keeps going when a market fails to load', async () => {
    let fail = true;
    await start({
      loadMarket: async (releaseId) => {
        if (fail) throw new Error('database down');
        return { releaseId };
      },
    });
    const socket = await connect();
    subscribe(socket, 1);
    await settle();
    expect(socket.received).toEqual([]);
    fail = false;
    hub.marketChanged(1);
    await messages(socket, 1);
  });
});

describe('private messages', () => {
  it('reach every tab of that user and nobody else', async () => {
    await start();
    const aliceTab1 = await connect({ cookie: 'u=alice' });
    const aliceTab2 = await connect({ cookie: 'u=alice' });
    const bob = await connect({ cookie: 'u=bob' });
    const guest = await connect();
    hub.notifyUser(ALICE.id, { type: 'order', releaseId: 1, orderId: 7 });
    await messages(aliceTab1, 1);
    await messages(aliceTab2, 1);
    await settle();
    expect(aliceTab1.received[0]).toEqual({ type: 'order', releaseId: 1, orderId: 7 });
    expect(bob.received).toEqual([]);
    expect(guest.received).toEqual([]);
  });
});

describe('who may connect', () => {
  it('refuses a page on another website', async () => {
    await start();
    await expect(connect({ origin: 'https://evil.example' })).rejects.toThrow(/403/);
  });

  it('accepts our own page', async () => {
    await start();
    const { port } = server.address();
    await connect({ origin: `http://127.0.0.1:${port}` });
  });

  it('only answers at /ws', async () => {
    await start();
    await expect(connect({ path: '/elsewhere' })).rejects.toThrow();
  });
});

describe('review fixes', () => {
  it('survives a visitor resetting the connection while their session is looked up', async () => {
    let finishLookup;
    const lookup = new Promise((resolve) => {
      finishLookup = resolve;
    });
    await start({ authenticate: () => lookup, connectionsPerIp: 1 });
    let raw;
    server.prependListener('upgrade', (_req, socket) => {
      raw = socket;
    });
    const attempt = connect({ cookie: 'u=alice' }).catch((error) => error);
    while (!raw) await settle(5);
    // What a TCP reset looks like to the server. With no listener this would throw and
    // take the process down.
    expect(() =>
      raw.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET' })),
    ).not.toThrow();
    finishLookup(SESSIONS['u=alice']);
    expect(await attempt).toBeInstanceOf(Error);
    await settle(20);
    // Nothing was handed over, and the address's slot was given back.
    await connect();
  });

  it('closes the tabs of a session that logged out, and only that session', async () => {
    await start();
    const laptopTab1 = await connect({ cookie: 'u=alice' });
    const laptopTab2 = await connect({ cookie: 'u=alice' });
    const phone = await connect({ cookie: 'u=alice-phone' });
    const closed = [laptopTab1, laptopTab2].map(
      (socket) => new Promise((resolve) => socket.once('close', resolve)),
    );
    hub.sessionEnded('alice-laptop');
    expect(await Promise.all(closed)).toEqual([LOGGED_OUT, LOGGED_OUT]);
    hub.notifyUser(ALICE.id, { type: 'wallet' });
    await messages(phone, 1);
  });

  it('does not load the market again when a tab re-subscribes to one it watches', async () => {
    await start();
    const socket = await connect();
    subscribe(socket, 1);
    subscribe(socket, 1);
    subscribe(socket, 1);
    await messages(socket, 1);
    await settle();
    expect(loads).toEqual([1]);
    expect(socket.received).toHaveLength(1);
  });

  it('caps open connections per address, and frees a slot when one closes', async () => {
    await start({ connectionsPerIp: 2 });
    const first = await connect();
    await connect();
    await expect(connect()).rejects.toThrow(/429/);
    first.close();
    await settle(30);
    await connect();
  });

  it('counts visitors behind the proxy by the address the proxy reports', async () => {
    await start({ connectionsPerIp: 1, trustProxy: true });
    await connect({ headers: { 'x-forwarded-for': '203.0.113.7' } });
    await connect({ headers: { 'x-forwarded-for': '198.51.100.2' } });
    // A visitor can't dodge the cap by adding their own entry in front.
    await expect(
      connect({ headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.7' } }),
    ).rejects.toThrow(/429/);
  });

  it('gives the slot back when ws rejects a malformed handshake', async () => {
    await start({ connectionsPerIp: 3 });
    const { port } = server.address();
    /** A WebSocket request with a missing key or a version ws doesn't speak. */
    const malformed = (headers) =>
      new Promise((resolve, reject) => {
        const socket = tcpConnect(port, '127.0.0.1', () => {
          socket.write(
            `GET ${LIVE_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
              `Upgrade: websocket\r\nConnection: Upgrade\r\n${headers}\r\n`,
          );
        });
        let reply = '';
        socket.on('data', (chunk) => (reply += chunk));
        socket.on('close', () => resolve(reply.split('\r\n')[0]));
        socket.on('error', reject);
      });
    for (let i = 0; i < 4; i += 1) {
      expect(await malformed('Sec-WebSocket-Version: 13\r\n')).toMatch(/400/);
      expect(
        await malformed('Sec-WebSocket-Version: 7\r\nSec-WebSocket-Key: dGhlIHNhbXBsZQ==\r\n'),
      ).toMatch(/400/);
    }
    await settle(20);
    // Eight rejected handshakes on a cap of three: none of them may still hold a slot.
    await connect();
    await connect();
    await connect();
  });

  it('allows 100 connections per address by default', async () => {
    await start({ connectionsPerIp: undefined });
    expect(hub.connectionsPerIp).toBe(100);
  });
});
