/**
 * Runs tasks one at a time per key, and tasks for different keys side by side.
 * The order service keys it by release id, so two orders for the same pressing can never
 * read the same book at once, while different pressings don't wait for each other.
 *
 * It only orders work inside this one server process. That's enough for a single Render
 * instance; the database locks are what keep money and copies safe across processes.
 */
export class KeyedSerialQueue {
  /** @type {Map<unknown, Promise<void>>} the tail of each key's chain */
  #tails = new Map();

  /**
   * @template T
   * @param {unknown} key
   * @param {() => Promise<T>} task
   * @returns {Promise<T>} settles like the task; a failure doesn't stop the next task
   */
  run(key, task) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => task());
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    // Forget a key once its last task is done, so the map doesn't grow with every pressing.
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }

  /** How many keys have work queued or running (for tests). */
  get size() {
    return this.#tails.size;
  }
}
