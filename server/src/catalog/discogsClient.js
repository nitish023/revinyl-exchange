/**
 * Talks to the Discogs API. Only the server calls Discogs, so our token never
 * reaches the browser or the repo (it lives in the DISCOGS_TOKEN env var).
 *
 * - Every request waits for a slot in a shared RateWindow (30/min by default).
 * - A 429 from Discogs pauses all requests for a minute instead of hammering them.
 * - Requests time out, so a slow Discogs can't hang our pages.
 */

import { SEARCH_PAGE_SIZE } from '../../../shared/index.js';
import { mapRelease, mapSearchResponse } from './discogsMapping.js';
import { RateLimitWaitTooLong } from './rateWindow.js';

const DEFAULT_BASE_URL = 'https://api.discogs.com';
const PAUSE_AFTER_429_MS = 60_000;

/** Our format filter values, as Discogs spells them. */
const DISCOGS_FORMATS = {
  lp: 'LP',
  '12in': '12"',
  '7in': '7"',
};

/** Discogs couldn't answer right now. Never shown raw: CatalogService turns it into an AppError. */
export class DiscogsUnavailableError extends Error {
  reason;
  constructor(reason, message) {
    super(message);
    this.name = 'DiscogsUnavailableError';
    this.reason = reason;
  }
}

/**
 * What CatalogService needs from Discogs. Tests pass a fake that serves fixtures.
 * @typedef {object} CatalogSource
 * @property {(query: string, page: number, filters?: import('../../../shared/catalog.js').SearchFilters) => Promise<import('../../../shared/catalog.js').SearchResults>} searchVinyl
 * @property {(id: number) => Promise<Omit<import('../../../shared/catalog.js').Release, 'fetchedAt'> | null>} getRelease
 *   null when Discogs has no release with that ID
 */

export class DiscogsClient {
  token;
  userAgent;
  limiter;
  baseUrl;
  timeoutMs;
  fetchImpl;
  now;
  pausedUntil = 0;

  /**
   * @param {{ token?: string, userAgent: string, limiter: import('./rateWindow.js').RateWindow,
   *   baseUrl?: string, timeoutMs?: number, fetch?: typeof fetch, now?: () => number }} options
   *   token: personal access token (search needs one; release lookups work without it)
   */
  constructor(options) {
    this.token = options.token || undefined;
    this.userAgent = options.userAgent;
    this.limiter = options.limiter;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  get hasToken() {
    return this.token !== undefined;
  }

  async searchVinyl(query, page, filters = {}) {
    if (!this.token) {
      throw new DiscogsUnavailableError(
        'not_configured',
        'Catalog search needs a Discogs token (set DISCOGS_TOKEN)',
      );
    }
    const params = {
      q: query,
      type: 'release',
      // Discogs' format filter also matches format descriptions like "LP" or "7\"".
      format: filters.format ? DISCOGS_FORMATS[filters.format] : 'Vinyl',
      per_page: String(SEARCH_PAGE_SIZE),
      page: String(page),
    };
    if (filters.year !== undefined) params.year = String(filters.year);
    const body = await this.getJson('/database/search', params);
    return mapSearchResponse(body, query, page, filters);
  }

  async getRelease(id) {
    const body = await this.getJson(`/releases/${id}`);
    return body === null ? null : mapRelease(body);
  }

  /** GET a Discogs endpoint. Returns null on 404; throws DiscogsUnavailableError otherwise. */
  async getJson(path, params = {}) {
    if (this.now() < this.pausedUntil) {
      throw new DiscogsUnavailableError('busy', 'Discogs asked us to slow down');
    }
    try {
      await this.limiter.acquire();
    } catch (error) {
      if (error instanceof RateLimitWaitTooLong) {
        throw new DiscogsUnavailableError('busy', 'Too many catalog requests right now');
      }
      throw error;
    }

    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers = {
      'User-Agent': this.userAgent,
      Accept: 'application/json',
    };
    if (this.token) headers.Authorization = `Discogs token=${this.token}`;

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new DiscogsUnavailableError('down', 'Could not reach Discogs');
    }

    if (response.status === 404) return null;
    if (response.status === 429) {
      this.pausedUntil = this.now() + PAUSE_AFTER_429_MS;
      throw new DiscogsUnavailableError('busy', 'Discogs rate limit reached');
    }
    if (!response.ok) {
      throw new DiscogsUnavailableError('down', `Discogs answered ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new DiscogsUnavailableError('down', 'Discogs sent a response we could not read');
    }
  }
}
