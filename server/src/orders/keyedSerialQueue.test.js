import { describe, expect, it } from 'vitest';
import { KeyedSerialQueue } from './keyedSerialQueue.js';

/** A promise you resolve from the outside, to control when a task finishes. */
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('KeyedSerialQueue', () => {
  it('runs tasks for the same key one at a time, in the order they arrived', async () => {
    const queue = new KeyedSerialQueue();
    const log = [];
    const first = gate();

    const a = queue.run(1, async () => {
      log.push('a starts');
      await first.promise;
      log.push('a ends');
      return 'a';
    });
    const b = queue.run(1, async () => {
      log.push('b starts');
      return 'b';
    });
    await tick();
    expect(log).toEqual(['a starts']);

    first.open();
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(log).toEqual(['a starts', 'a ends', 'b starts']);
  });

  it('lets different keys run at the same time', async () => {
    const queue = new KeyedSerialQueue();
    const blocked = gate();
    const log = [];

    const slow = queue.run(1, async () => {
      await blocked.promise;
      log.push('key 1');
    });
    await queue.run(2, async () => log.push('key 2'));

    expect(log).toEqual(['key 2']);
    blocked.open();
    await slow;
    expect(log).toEqual(['key 2', 'key 1']);
  });

  it('passes a failure to its caller and still runs the next task', async () => {
    const queue = new KeyedSerialQueue();

    const failing = queue.run(1, async () => {
      throw new Error('boom');
    });
    const next = queue.run(1, async () => 'still runs');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('still runs');
  });

  it('catches a task that throws before returning a promise', async () => {
    const queue = new KeyedSerialQueue();

    const failing = queue.run(1, () => {
      throw new Error('sync boom');
    });

    await expect(failing).rejects.toThrow('sync boom');
    await expect(queue.run(1, async () => 'ok')).resolves.toBe('ok');
  });

  it('forgets a key once its work is done', async () => {
    const queue = new KeyedSerialQueue();

    await Promise.all([queue.run(1, async () => {}), queue.run(2, async () => {})]);
    await tick();

    expect(queue.size).toBe(0);
  });
});
