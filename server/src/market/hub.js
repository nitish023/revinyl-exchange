/**
 * Live updates over one WebSocket per browser tab, at /ws.
 *
 * Public: a tab subscribes to pressings and gets the whole market for each one when it
 * subscribes and again whenever it changes. Several changes close together (a trade
 * changes both sides at once) are sent as one update, and only pressings someone is
 * watching are ever loaded.
 * Private: a logged-in tab also gets messages meant only for that user (their order
 * filled, their wallet changed). Who you are comes from the session cookie when the
 * connection opens, the same way the API knows.
 *
 * Logging out closes that session's connections, so no other tab keeps getting its
 * private messages (the browser reconnects as a guest).
 *
 * The rest of the server only sees the LiveUpdates methods (marketChanged, notifyUser,
 * sessionEnded), so Part 3 code doesn't know or care that WebSockets are involved.
 */
import { WebSocketServer } from 'ws';
import { MAX_SUBSCRIPTIONS, liveRequestSchema } from '../../../shared/market.js';
import { originHost } from '../http/sameOrigin.js';
import { LiveUpdates } from './live.js';

export const LIVE_PATH = '/ws';

/** Closing codes the browser sees. 1008 = policy violation (RFC 6455); 4000s are ours. */
const TOO_MANY_MESSAGES = 1008;
export const LOGGED_OUT = 4001;

/**
 * @typedef {object} HubOptions
 * @property {(releaseId: number) => Promise<object>} loadMarket
 * @property {(cookieHeader: string | undefined) =>
 *   Promise<{ userId: number, sessionId: string } | null>} authenticate
 *   who the session cookie belongs to; sessionId is what logout passes to sessionEnded()
 * @property {number} [coalesceMs] how long to gather changes before sending (default 50)
 * @property {number} [heartbeatMs] how often to check the connection is alive (default 30s)
 * @property {number} [messagesPerMinute] per connection, before it's closed (default 120)
 * @property {number} [connectionsPerIp] open connections one address may hold (default 100:
 *   a whole class demo can share one campus Wi-Fi address)
 * @property {boolean} [trustProxy] read the visitor's address from X-Forwarded-For (Render)
 * @property {(message: string, error?: unknown) => void} [log]
 */

export class MarketHub extends LiveUpdates {
  /** @type {Map<number, Set<import('ws').WebSocket>>} who watches each pressing */
  #rooms = new Map();
  /** @type {Map<number, Set<import('ws').WebSocket>>} each user's open tabs */
  #users = new Map();
  /** @type {Map<string, Set<import('ws').WebSocket>>} the tabs opened with each session */
  #sessions = new Map();
  /** @type {Map<string, number>} open connections (and ones being opened) per address */
  #perIp = new Map();
  /** @type {Set<number>} pressings changed since the last send */
  #pending = new Set();
  #timer = null;
  #heartbeat = null;
  #wss;

  /** @param {HubOptions} options */
  constructor({
    loadMarket,
    authenticate,
    coalesceMs = 50,
    heartbeatMs = 30_000,
    messagesPerMinute = 120,
    connectionsPerIp = 100,
    trustProxy = false,
    log = (message, error) => console.error(`[live] ${message}`, error ?? ''),
  }) {
    super();
    this.loadMarket = loadMarket;
    this.authenticate = authenticate;
    this.coalesceMs = coalesceMs;
    this.heartbeatMs = heartbeatMs;
    this.messagesPerMinute = messagesPerMinute;
    this.connectionsPerIp = connectionsPerIp;
    this.trustProxy = trustProxy;
    this.log = log;
    // Messages from browsers are tiny ({"type":"subscribe","releaseId":123}).
    this.#wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  }

  /** Accept WebSocket upgrades at /ws on this HTTP server. */
  attach(server) {
    server.on('upgrade', (req, socket, head) => {
      this.#upgrade(req, socket, head).catch((error) => {
        this.log('upgrade failed', error);
        socket.destroy();
      });
    });
    this.#heartbeat = setInterval(() => this.#checkAlive(), this.heartbeatMs);
    this.#heartbeat.unref();
  }

  /** @override */
  marketChanged(releaseId) {
    if (!this.#rooms.has(releaseId)) return; // nobody is looking at it
    this.#pending.add(releaseId);
    this.#timer ??= setTimeout(() => void this.#flush(), this.coalesceMs);
  }

  /** @override */
  notifyUser(userId, message) {
    const text = JSON.stringify(message);
    for (const socket of this.#users.get(userId) ?? []) send(socket, text);
  }

  /** @override Logging out: close every connection opened with that session. */
  sessionEnded(sessionId) {
    for (const socket of this.#sessions.get(sessionId) ?? [])
      socket.close(LOGGED_OUT, 'Logged out');
  }

  /** How many tabs watch a pressing (for tests and logs). */
  watchers(releaseId) {
    return this.#rooms.get(releaseId)?.size ?? 0;
  }

  close() {
    clearInterval(this.#heartbeat);
    clearTimeout(this.#timer);
    this.#timer = null;
    for (const socket of this.#wss.clients) socket.terminate();
    this.#wss.close();
  }

  async #upgrade(req, socket, head) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== LIVE_PATH) return socket.destroy();

    // Until handleUpgrade takes over, nothing else listens for errors on this raw socket,
    // and an unheard 'error' (a visitor resetting the connection while we look up their
    // session) would crash the whole server. This listener covers every path below.
    const onSocketError = () => socket.destroy();
    socket.on('error', onSocketError);

    // Browsers always send Origin on WebSockets. Another website must not be able to open
    // one with our visitor's cookie and read their private messages.
    const origin = req.headers.origin;
    if (origin && originHost(origin) !== req.headers.host) {
      return refuse(socket, '403 Forbidden');
    }
    const ip = this.#clientIp(req);
    if ((this.#perIp.get(ip) ?? 0) >= this.connectionsPerIp) {
      return refuse(socket, '429 Too Many Requests');
    }
    if (socket.destroyed) return; // already gone: nothing to count
    // The slot is given back when this TCP connection closes, however it ends: a normal
    // close, a reset, a refusal, or ws rejecting a malformed handshake (which answers 400
    // itself and never calls us back).
    this.#perIp.set(ip, (this.#perIp.get(ip) ?? 0) + 1);
    socket.once('close', () => this.#release(ip));

    const session = await this.authenticate(req.headers.cookie);
    if (socket.destroyed) return; // they left while we were looking
    socket.removeListener('error', onSocketError);
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#connected(ws, session));
  }

  /** The visitor's address. Behind Render's proxy, the last X-Forwarded-For entry is the one it added. */
  #clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (this.trustProxy && typeof forwarded === 'string') {
      return forwarded.split(',').at(-1).trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  #release(ip) {
    const count = (this.#perIp.get(ip) ?? 1) - 1;
    if (count > 0) this.#perIp.set(ip, count);
    else this.#perIp.delete(ip);
  }

  #connected(ws, session) {
    const subscriptions = new Set();
    let alive = true;
    let windowStart = Date.now();
    let messages = 0;

    ws.isAlive = () => alive;
    ws.markDead = () => {
      alive = false;
    };
    ws.on('pong', () => {
      alive = true;
    });

    if (session) {
      addTo(this.#users, session.userId, ws);
      addTo(this.#sessions, session.sessionId, ws);
    }

    ws.on('message', (data, isBinary) => {
      if (Date.now() - windowStart > 60_000) {
        windowStart = Date.now();
        messages = 0;
      }
      if (++messages > this.messagesPerMinute) {
        ws.close(TOO_MANY_MESSAGES, 'Too many messages');
        return;
      }
      const request = isBinary ? null : parseRequest(data.toString());
      if (!request) {
        send(ws, JSON.stringify({ type: 'error', message: 'That message was not understood' }));
        return;
      }
      if (request.type === 'unsubscribe') {
        subscriptions.delete(request.releaseId);
        removeFrom(this.#rooms, request.releaseId, ws);
        return;
      }
      // Already watching: it has the market and gets every change, so don't load it again.
      if (subscriptions.has(request.releaseId)) return;
      if (subscriptions.size >= MAX_SUBSCRIPTIONS) {
        send(ws, JSON.stringify({ type: 'error', message: 'Watching too many pressings at once' }));
        return;
      }
      subscriptions.add(request.releaseId);
      addTo(this.#rooms, request.releaseId, ws);
      void this.#sendMarket(request.releaseId, [ws]);
    });

    ws.on('close', () => {
      for (const releaseId of subscriptions) removeFrom(this.#rooms, releaseId, ws);
      if (session) {
        removeFrom(this.#users, session.userId, ws);
        removeFrom(this.#sessions, session.sessionId, ws);
      }
    });
    ws.on('error', (error) => this.log('connection error', error));
  }

  async #flush() {
    this.#timer = null;
    const releaseIds = [...this.#pending];
    this.#pending.clear();
    await Promise.all(
      releaseIds.map((releaseId) => this.#sendMarket(releaseId, this.#rooms.get(releaseId) ?? [])),
    );
  }

  async #sendMarket(releaseId, sockets) {
    let market;
    try {
      market = await this.loadMarket(releaseId);
    } catch (error) {
      this.log(`could not load the market for ${releaseId}`, error);
      return;
    }
    const text = JSON.stringify({ type: 'market', releaseId, market });
    for (const socket of sockets) send(socket, text);
  }

  /** Ping every connection; one that didn't answer the last ping is gone (a closed laptop). */
  #checkAlive() {
    for (const ws of this.#wss.clients) {
      if (!ws.isAlive?.()) {
        ws.terminate();
        continue;
      }
      ws.markDead();
      ws.ping();
    }
  }
}

function parseRequest(text) {
  try {
    const result = liveRequestSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Answer a WebSocket request with an HTTP error and hang up. */
function refuse(socket, status) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function send(socket, text) {
  if (socket.readyState === socket.OPEN) socket.send(text);
}

function addTo(map, key, socket) {
  const set = map.get(key) ?? new Set();
  set.add(socket);
  map.set(key, set);
}

function removeFrom(map, key, socket) {
  const set = map.get(key);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) map.delete(key);
}
