/**
 * Test helpers: a context wired to the test database and a fake Discogs that
 * serves saved responses, so tests never call the real API.
 */
import { CatalogService } from '../src/catalog/catalogService.js';
import { mapRelease, mapSearchResponse } from '../src/catalog/discogsMapping.js';
import releaseFixture from '../src/catalog/fixtures/release-249504.json' with { type: 'json' };
import searchFixture from '../src/catalog/fixtures/search-astley.json' with { type: 'json' };
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://revinyl:revinyl@localhost:5433/revinyl_test';

export const CATALOG_MAX_AGE_MS = 6 * 3_600_000;

/** Stands in for Discogs. Release 249504 is a real 7" single (see fixtures/). */
export class FakeCatalogSource {
  releaseCalls = 0;
  searchCalls = 0;
  /** @type {Error | null} */
  failWith = null;
  lastSearchFilters = null;

  async searchVinyl(query, page, filters = {}) {
    this.searchCalls += 1;
    this.lastSearchFilters = filters;
    if (this.failWith) throw this.failWith;
    return mapSearchResponse(searchFixture, query, page, filters);
  }

  async getRelease(id) {
    this.releaseCalls += 1;
    if (this.failWith) throw this.failWith;
    return id === releaseFixture.id ? mapRelease(releaseFixture) : null;
  }
}

export function createTestContext() {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL });
  const pool = createPool(TEST_DATABASE_URL);
  const catalogSource = new FakeCatalogSource();
  const catalog = new CatalogService({ pool, source: catalogSource, maxAgeMs: CATALOG_MAX_AGE_MS });
  return { config, pool, catalog, catalogSource };
}

/** Empty every table between tests (keeps the schema). */
export async function resetDatabase(pool) {
  await pool.query('TRUNCATE users, sessions, releases RESTART IDENTITY CASCADE');
}
