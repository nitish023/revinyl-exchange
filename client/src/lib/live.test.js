import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveConnection, RETRY_DELAYS_MS } from './live.js';

/** A WebSocket we control: the test decides when it opens, closes or gets a message. */
class FakeSocket {
  readyState = 0;
  sent = [];
  constructor(url) {
    this.url = url;
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

let sockets;
let timers;
let connection;

beforeEach(() => {
  sockets = [];
  timers = [];
  connection = new LiveConnection({
    url: () => 'ws://test/ws',
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimer: (fn, delay) => {
      const timer = { fn, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timers = timers.filter((t) => t !== timer);
    },
  });
});

const runNextTimer = () => timers.shift().fn();

describe('watching a pressing', () => {
  it('connects on the first watch and subscribes once it opens', () => {
    expect(sockets).toHaveLength(0);
    connection.watch(1, () => {});
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    expect(sockets[0].sent).toEqual([{ type: 'subscribe', releaseId: 1 }]);
    expect(connection.status).toBe('live');
  });

  it('gives each pressing’s market only to its own watchers', () => {
    const one = vi.fn();
    const two = vi.fn();
    connection.watch(1, one);
    connection.watch(2, two);
    sockets[0].open();
    sockets[0].receive({ type: 'market', releaseId: 1, market: { releaseId: 1 } });
    expect(one).toHaveBeenCalledWith({ releaseId: 1 });
    expect(two).not.toHaveBeenCalled();
  });

  it('unsubscribes when the last watcher of a pressing stops', () => {
    const stopA = connection.watch(1, () => {});
    const stopB = connection.watch(1, () => {});
    sockets[0].open();
    stopA();
    expect(sockets[0].sent).toEqual([{ type: 'subscribe', releaseId: 1 }]);
    stopB();
    stopB(); // stopping twice is harmless
    expect(sockets[0].sent.at(-1)).toEqual({ type: 'unsubscribe', releaseId: 1 });
    expect(sockets[0].sent.filter((m) => m.type === 'unsubscribe')).toHaveLength(1);
  });

  it('passes private messages on, and ignores junk', () => {
    const listener = vi.fn();
    connection.onPrivate(listener);
    connection.watch(1, () => {});
    sockets[0].open();
    sockets[0].onmessage({ data: 'not json' });
    sockets[0].receive({ type: 'order', releaseId: 1 });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'order', releaseId: 1 });
  });
});

describe('when the connection drops', () => {
  it('reconnects with growing pauses and subscribes again', () => {
    const statuses = [];
    connection.onStatus((status) => statuses.push(status));
    connection.watch(1, () => {});
    connection.watch(2, () => {});
    sockets[0].open();
    sockets[0].drop();
    expect(timers.map((t) => t.delay)).toEqual([RETRY_DELAYS_MS[0]]);
    runNextTimer();
    sockets[1].drop(); // still down
    expect(timers.map((t) => t.delay)).toEqual([RETRY_DELAYS_MS[1]]);
    runNextTimer();
    sockets[2].open();
    expect(sockets[2].sent).toEqual([
      { type: 'subscribe', releaseId: 1 },
      { type: 'subscribe', releaseId: 2 },
    ]);
    expect(statuses).toEqual(['idle', 'connecting', 'live', 'reconnecting', 'live']);
  });

  it('never waits longer than the last delay', () => {
    connection.watch(1, () => {});
    for (let i = 0; i < 10; i += 1) {
      sockets.at(-1).drop();
      runNextTimer();
    }
    sockets.at(-1).drop();
    expect(timers[0].delay).toBe(RETRY_DELAYS_MS.at(-1));
  });

  it('starts over at the shortest pause after a good connection', () => {
    connection.watch(1, () => {});
    sockets[0].drop();
    runNextTimer();
    sockets[1].drop();
    runNextTimer();
    sockets[2].open();
    sockets[2].drop();
    expect(timers[0].delay).toBe(RETRY_DELAYS_MS[0]);
  });

  it('stays closed when nothing is being watched', () => {
    const stop = connection.watch(1, () => {});
    sockets[0].open();
    stop();
    sockets[0].drop();
    expect(timers).toEqual([]);
    expect(connection.status).toBe('idle');
  });
});

describe('reconnect()', () => {
  it('replaces the connection right away (after logging in or out)', () => {
    connection.watch(1, () => {});
    sockets[0].open();
    connection.reconnect();
    expect(sockets).toHaveLength(2);
    expect(sockets[0].readyState).toBe(3);
    expect(timers).toEqual([]); // the old socket closing doesn't schedule a retry
    sockets[1].open();
    expect(sockets[1].sent).toEqual([{ type: 'subscribe', releaseId: 1 }]);
  });
});

describe('private messages only', () => {
  it('opens the connection for a page that only listens for private messages', () => {
    const listener = vi.fn();
    const stop = connection.onPrivate(listener);
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    sockets[0].receive({ type: 'trade', releaseId: 1, tradeId: 4 });
    expect(listener).toHaveBeenCalledOnce();
    sockets[0].drop();
    expect(timers).toHaveLength(1); // still wanted, so it reconnects
    runNextTimer();
    stop();
    sockets[1].drop();
    expect(timers).toEqual([]); // nobody listening any more
  });
});
