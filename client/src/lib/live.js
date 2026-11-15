/**
 * The browser's side of live updates: one WebSocket to /ws shared by the whole tab.
 *
 *   const stop = live.watch(249504, (market) => redraw(market));   // later: stop()
 *   live.onPrivate((message) => ...);       // { type: 'order' | 'trade' | 'wallet', ... }
 *                                           // (also opens the connection, e.g. on the Listening Room)
 *   live.onStatus((status) => ...);         // 'connecting' | 'live' | 'reconnecting'
 *
 * It connects the first time something is watched, and if the connection drops it
 * reconnects with growing pauses (1s, 2s, 4s… up to 30s) and subscribes again, so a
 * laptop waking from sleep catches up by itself. reconnect() is for logging in or out:
 * the server reads who you are when the connection opens.
 */

export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export class LiveConnection {
  /** @type {Map<number, Set<(market: object) => void>>} */
  #watchers = new Map();
  #privateListeners = new Set();
  #statusListeners = new Set();
  #socket = null;
  #retryTimer = null;
  #attempt = 0;
  #status = 'idle';

  /**
   * @param {{ url: () => string, createSocket?: (url: string) => WebSocket,
   *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} options
   *   createSocket and the timers are swapped for fakes in tests.
   */
  constructor({
    url,
    createSocket = (address) => new WebSocket(address),
    // Wrapped, because the browser's setTimeout throws "Illegal invocation" when it's
    // called as a method of another object (this.setTimer(...)).
    setTimer = (fn, delay) => setTimeout(fn, delay),
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    this.url = url;
    this.createSocket = createSocket;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  get status() {
    return this.#status;
  }

  /** Get a pressing's market now and after every change. Returns a function that stops. */
  watch(releaseId, onMarket) {
    const listeners = this.#watchers.get(releaseId) ?? new Set();
    const first = listeners.size === 0;
    listeners.add(onMarket);
    this.#watchers.set(releaseId, listeners);
    if (first) this.#send({ type: 'subscribe', releaseId });
    this.#ensureOpen();
    return () => {
      listeners.delete(onMarket);
      if (listeners.size > 0 || this.#watchers.get(releaseId) !== listeners) return;
      this.#watchers.delete(releaseId);
      this.#send({ type: 'unsubscribe', releaseId });
    };
  }

  /** Messages meant only for you. Listening opens the connection, like watching does. */
  onPrivate(listener) {
    this.#privateListeners.add(listener);
    this.#ensureOpen();
    return () => this.#privateListeners.delete(listener);
  }

  onStatus(listener) {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }

  /** Start again with a fresh connection (after logging in or out). */
  reconnect() {
    this.#attempt = 0;
    this.clearTimer(this.#retryTimer);
    this.#retryTimer = null;
    const old = this.#socket;
    this.#socket = null;
    if (old) {
      old.onclose = null;
      old.close();
    }
    if (this.#wanted()) this.#open();
  }

  /** Is anything on the page listening? With nothing, a dropped connection stays closed. */
  #wanted() {
    return this.#watchers.size > 0 || this.#privateListeners.size > 0;
  }

  #ensureOpen() {
    if (!this.#socket && !this.#retryTimer) this.#open();
  }

  #open() {
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    let socket;
    try {
      socket = this.createSocket(this.url());
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      this.#attempt = 0;
      this.#setStatus('live');
      for (const releaseId of this.#watchers.keys()) this.#send({ type: 'subscribe', releaseId });
    };
    socket.onmessage = (event) => this.#receive(event.data);
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#scheduleRetry();
    };
  }

  #scheduleRetry() {
    if (!this.#wanted()) {
      this.#setStatus('idle');
      return;
    }
    this.#setStatus('reconnecting');
    const delay = RETRY_DELAYS_MS[Math.min(this.#attempt, RETRY_DELAYS_MS.length - 1)];
    this.#attempt += 1;
    this.#retryTimer = this.setTimer(() => {
      this.#retryTimer = null;
      this.#open();
    }, delay);
  }

  #receive(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message?.type === 'market') {
      for (const listener of this.#watchers.get(message.releaseId) ?? []) listener(message.market);
    } else if (message?.type === 'error') {
      console.warn('[live]', message.message);
    } else if (message?.type) {
      for (const listener of this.#privateListeners) listener(message);
    }
  }

  #send(message) {
    // Before the connection opens, onopen subscribes to everything being watched.
    if (this.#socket?.readyState === 1) this.#socket.send(JSON.stringify(message));
  }

  #setStatus(status) {
    if (status === this.#status) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }
}

/** The tab's one connection, at the same host as the page (Vite forwards /ws in development). */
export const live = new LiveConnection({
  url: () => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
});
