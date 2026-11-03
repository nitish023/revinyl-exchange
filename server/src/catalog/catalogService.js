/**
 * The catalog: search Discogs for vinyl pressings and serve pressing pages.
 *
 * Pressing details are cached in the `releases` table and refreshed once they're
 * older than `maxAgeMs` (6 hours by default), so popular pages cost one Discogs
 * call every few hours instead of one per visit. Search results are cached in
 * memory for a few minutes, since people often repeat or page back.
 *
 * If Discogs is down or busy, a stale cached pressing is still shown (a demo
 * shouldn't break because Discogs hiccuped); a pressing we've never seen fails
 * with a friendly 503.
 */

import { AppError, notFound } from '../errors.js';
import { DiscogsUnavailableError } from './discogsClient.js';
import { isVinyl } from './discogsMapping.js';
import { findRelease, upsertRelease } from './releasesRepo.js';

const SEARCH_CACHE_TTL_MS = 10 * 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 200;

function unavailable(error) {
  if (error.reason === 'not_configured') {
    return new AppError(
      503,
      'CATALOG_NOT_CONFIGURED',
      'Record search is not set up on this server yet',
    );
  }
  return new AppError(
    503,
    'CATALOG_UNAVAILABLE',
    'The record catalog is busy right now. Please try again in a minute.',
  );
}

export class CatalogService {
  pool;
  source;
  maxAgeMs;
  now;
  searchCache = new Map();
  /** One Discogs fetch per release at a time, even if many people open the page at once. */
  inFlight = new Map();

  constructor(options) {
    this.pool = options.pool;
    this.source = options.source;
    this.maxAgeMs = options.maxAgeMs;
    this.now = options.now ?? Date.now;
  }

  async search(query, page, filters = {}) {
    const key = [query.toLowerCase(), page, filters.format ?? '', filters.year ?? ''].join('|');
    const cached = this.searchCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.results;

    let results;
    try {
      results = await this.source.searchVinyl(query, page, filters);
    } catch (error) {
      if (error instanceof DiscogsUnavailableError) throw unavailable(error);
      throw error;
    }

    this.searchCache.delete(key); // re-insert so it counts as newest
    this.searchCache.set(key, { expiresAt: this.now() + SEARCH_CACHE_TTL_MS, results });
    while (this.searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = this.searchCache.keys().next().value;
      if (oldest === undefined) break;
      this.searchCache.delete(oldest);
    }
    return results;
  }

  /** A pressing page. Throws 404 for unknown or non-vinyl releases. */
  async getRelease(id) {
    const cached = await findRelease(this.pool, id);
    if (cached && this.isFresh(cached)) return cached;

    try {
      return await this.refresh(id);
    } catch (error) {
      if (error instanceof DiscogsUnavailableError) {
        if (cached) return cached; // stale beats broken
        throw unavailable(error);
      }
      throw error;
    }
  }

  /**
   * Make sure a pressing is cached before anything references it (copies, orders).
   * Part 3 calls this before inserting a copy or order for a release.
   */
  async ensureRelease(id) {
    const cached = await findRelease(this.pool, id);
    return cached ?? this.getRelease(id);
  }

  isFresh(release) {
    return this.now() - Date.parse(release.fetchedAt) < this.maxAgeMs;
  }

  refresh(id) {
    const pending = this.inFlight.get(id);
    if (pending) return pending;
    const work = (async () => {
      const release = await this.source.getRelease(id);
      if (!release || !isVinyl(release)) throw notFound('Vinyl pressing');
      return upsertRelease(this.pool, release, new Date(this.now()));
    })().finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, work);
    return work;
  }
}
