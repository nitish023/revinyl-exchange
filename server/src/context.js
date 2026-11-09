/**
 * Everything the routes share: settings, the database pool and services.
 * Tests build their own context with a fake Discogs (server/test/helpers.js).
 */
import { CatalogService } from './catalog/catalogService.js';
import { DiscogsClient } from './catalog/discogsClient.js';
import { RateWindow } from './catalog/rateWindow.js';
import { createPool } from './db/pool.js';
import { sessionFromCookie } from './auth/sessions.js';
import { MarketHub } from './market/hub.js';
import { loadMarket } from './market/marketRepo.js';

/**
 * @typedef {object} AppContext
 * @property {import('./config.js').Config} config
 * @property {import('pg').Pool} pool
 * @property {CatalogService} catalog
 * @property {import('./market/live.js').LiveUpdates} live tells browsers what changed. Here it's
 *   the WebSocket hub; index.js attaches it to the HTTP server.
 */

/** @param {import('./config.js').Config} config @returns {AppContext} */
export function createContext(config) {
  const pool = createPool(config.DATABASE_URL);
  const discogs = new DiscogsClient({
    token: config.DISCOGS_TOKEN,
    userAgent: config.DISCOGS_USER_AGENT,
    limiter: new RateWindow({
      limit: config.DISCOGS_REQUESTS_PER_MINUTE,
      windowMs: 60_000,
      maxWaitMs: 5_000,
    }),
  });
  const catalog = new CatalogService({
    pool,
    source: discogs,
    maxAgeMs: config.CATALOG_MAX_AGE_HOURS * 3_600_000,
  });
  if (!discogs.hasToken)
    console.warn('[catalog] DISCOGS_TOKEN is not set: record search is disabled');
  const live = new MarketHub({
    loadMarket: (releaseId) => loadMarket(pool, releaseId),
    authenticate: sessionFromCookie(pool),
    trustProxy: config.isProduction,
  });
  return { config, pool, catalog, live };
}
