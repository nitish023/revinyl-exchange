/**
 * The live hub over a real WebSocket on a random local port. The market and the login
 * are fakes, so this runs without a database.
 */
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { LIVE_PATH, MarketHub } from './hub.js';

const ALICE = { id: 1 };
const BOB = { id: 2 };

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
    findUser: async (cookie) => ({ 'u=alice': ALICE, 'u=bob': BOB })[cookie] ?? null,
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
async function connect({ cookie, origin, path = LIVE_PATH } = {}) {
  const { port } = server.address();
  const headers = {};
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
