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
 * The rest of the server only sees the LiveUpdates methods (marketChanged, notifyUser),
 * so Part 3 code doesn't know or care that WebSockets are involved.
 */
import { WebSocketServer } from 'ws';
import { MAX_SUBSCRIPTIONS, liveRequestSchema } from '../../../shared/market.js';
import { LiveUpdates } from './live.js';

export const LIVE_PATH = '/ws';

/** Closing codes the browser sees. 1008 = policy violation (RFC 6455). */
const TOO_MANY_MESSAGES = 1008;

/**
 * @typedef {object} HubOptions
 * @property {(releaseId: number) => Promise<object>} loadMarket
 * @property {(cookieHeader: string | undefined) => Promise<{ id: number } | null>} findUser
 * @property {number} [coalesceMs] how long to gather changes before sending (default 50)
 * @property {number} [heartbeatMs] how often to check the connection is alive (default 30s)
 * @property {number} [messagesPerMinute] per connection, before it's closed (default 120)
 * @property {(message: string, error?: unknown) => void} [log]
 */

export class MarketHub extends LiveUpdates {
  /** @type {Map<number, Set<import('ws').WebSocket>>} who watches each pressing */
  #rooms = new Map();
  /** @type {Map<number, Set<import('ws').WebSocket>>} each user's open tabs */
  #users = new Map();
  /** @type {Set<number>} pressings changed since the last send */
  #pending = new Set();
  #timer = null;
  #heartbeat = null;
  #wss;

  /** @param {HubOptions} options */
  constructor({
    loadMarket,
    findUser,
    coalesceMs = 50,
    heartbeatMs = 30_000,
    messagesPerMinute = 120,
    log = (message, error) => console.error(`[live] ${message}`, error ?? ''),
  }) {
    super();
    this.loadMarket = loadMarket;
    this.findUser = findUser;
    this.coalesceMs = coalesceMs;
    this.heartbeatMs = heartbeatMs;
    this.messagesPerMinute = messagesPerMinute;
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
    // Browsers always send Origin on WebSockets. Another website must not be able to open
    // one with our visitor's cookie and read their private messages.
    const origin = req.headers.origin;
    if (origin && hostOf(origin) !== req.headers.host) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const user = await this.findUser(req.headers.cookie);
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#connected(ws, user));
  }

  #connected(ws, user) {
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

    if (user) addTo(this.#users, user.id, ws);

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
      if (!subscriptions.has(request.releaseId) && subscriptions.size >= MAX_SUBSCRIPTIONS) {
        send(ws, JSON.stringify({ type: 'error', message: 'Watching too many pressings at once' }));
        return;
      }
      subscriptions.add(request.releaseId);
      addTo(this.#rooms, request.releaseId, ws);
      void this.#sendMarket(request.releaseId, [ws]);
    });

    ws.on('close', () => {
      for (const releaseId of subscriptions) removeFrom(this.#rooms, releaseId, ws);
      if (user) removeFrom(this.#users, user.id, ws);
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

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
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
