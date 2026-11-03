import { describe, expect, it } from 'vitest';
import { RateLimitWaitTooLong, RateWindow } from './rateWindow.js';

/** A clock tests can move by hand; sleeping just advances it. */
function fakeClock() {
  let now = 0;
  const sleeps = [];
  return {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
    sleeps,
  };
}

describe('RateWindow', () => {
  it('lets requests through immediately while under the limit', async () => {
    const clock = fakeClock();
    const window = new RateWindow({ limit: 3, windowMs: 60_000, maxWaitMs: 5_000, ...clock });
    await window.acquire();
    await window.acquire();
    await window.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it('waits for the oldest request to leave the window', async () => {
    const clock = fakeClock();
    const window = new RateWindow({ limit: 2, windowMs: 10_000, maxWaitMs: 10_000, ...clock });
    await window.acquire(); // t=0
    clock.advance(4_000);
    await window.acquire(); // t=4000
    await window.acquire(); // must wait until t=10000
    expect(clock.sleeps).toEqual([6_000]);
    expect(clock.now()).toBe(10_000);
  });

  it('gives up instead of waiting longer than maxWaitMs', async () => {
    const clock = fakeClock();
    const window = new RateWindow({ limit: 1, windowMs: 60_000, maxWaitMs: 5_000, ...clock });
    await window.acquire();
    await expect(window.acquire()).rejects.toBeInstanceOf(RateLimitWaitTooLong);
    // A caller that gave up doesn't block the next one once the window frees up.
    clock.advance(60_000);
    await expect(window.acquire()).resolves.toBeUndefined();
  });

  it('serves concurrent callers in order without exceeding the limit', async () => {
    const clock = fakeClock();
    const window = new RateWindow({ limit: 2, windowMs: 1_000, maxWaitMs: 5_000, ...clock });
    const started = [];
    await Promise.all(
      [1, 2, 3, 4].map(async (id) => {
        await window.acquire();
        started.push(id);
      }),
    );
    expect(started).toEqual([1, 2, 3, 4]);
    expect(clock.sleeps).toEqual([1_000]);
  });
});
