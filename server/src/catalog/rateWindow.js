/**
 * A sliding-window rate limiter for our outgoing Discogs calls.
 *
 * Discogs allows 60 authenticated requests per minute, shared by everyone using
 * our site (it's one token). We cap ourselves lower (30/min by default) so a busy
 * demo never gets us rate-limited. Callers wait their turn instead of failing,
 * but never for longer than `maxWaitMs`: a page shouldn't hang for a minute.
 */

export class RateLimitWaitTooLong extends Error {
  waitMs;
  constructor(waitMs) {
    super(`Rate limit wait of ${waitMs}ms is too long`);
    this.name = 'RateLimitWaitTooLong';
    this.waitMs = waitMs;
  }
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateWindow {
  limit;
  windowMs;
  maxWaitMs;
  now;
  sleep;
  /** Start times of requests still inside the window, oldest first. */
  starts = [];
  /** Callers are served one at a time so two can't grab the same free slot. */
  queue = Promise.resolve();

  constructor(options) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxWaitMs = options.maxWaitMs;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Resolves when a request may start; rejects with RateLimitWaitTooLong otherwise. */
  acquire() {
    const turn = this.queue.then(() => this.takeSlot());
    // Keep the chain alive even if this caller gives up.
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  /** How long the next caller would have to wait right now (for tests and logging). */
  currentWaitMs() {
    this.dropExpired();
    if (this.starts.length < this.limit) return 0;
    return this.starts[0] + this.windowMs - this.now();
  }

  async takeSlot() {
    const wait = this.currentWaitMs();
    if (wait > this.maxWaitMs) throw new RateLimitWaitTooLong(wait);
    if (wait > 0) {
      await this.sleep(wait);
      this.dropExpired();
    }
    this.starts.push(this.now());
  }

  dropExpired() {
    const cutoff = this.now() - this.windowMs;
    while (this.starts.length > 0 && this.starts[0] <= cutoff) this.starts.shift();
  }
}
