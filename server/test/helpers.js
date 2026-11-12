/**
 * Test helpers: a context wired to the test database and a fake Discogs that
 * serves saved responses, so tests never call the real API.
 */
import { CatalogService } from '../src/catalog/catalogService.js';
import { DiscogsUnavailableError } from '../src/catalog/discogsClient.js';
import {
  conditionFieldIds,
  mapCollectionPage,
  mapRelease,
  mapSearchResponse,
} from '../src/catalog/discogsMapping.js';
import collectionFixture from '../src/catalog/fixtures/collection-page.json' with { type: 'json' };
import fieldsFixture from '../src/catalog/fixtures/collection-fields.json' with { type: 'json' };
import releaseFixture from '../src/catalog/fixtures/release-249504.json' with { type: 'json' };
import searchFixture from '../src/catalog/fixtures/search-astley.json' with { type: 'json' };
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { LiveUpdates } from '../src/market/live.js';
import { CollectionImport } from '../src/collection/importService.js';
import { OrderService } from '../src/orders/orderService.js';

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

  /**
   * Discogs users for collection tests: "digger" has the fixture collection, "shy" keeps
   * theirs private, and anyone else doesn't exist. `collectionPages` makes digger's
   * collection that many pages long, and `collectionRepeat` repeats the fixture's five items
   * (four vinyl, one CD) that many times on each page, always with new instance ids.
   */
  collectionCalls = 0;
  collectionPages = 1;
  collectionRepeat = 1;

  async getConditionFields(username) {
    this.collectionCalls += 1;
    if (this.failWith) throw this.failWith;
    if (username === 'shy') throw new DiscogsUnavailableError('private', 'Discogs answered 403');
    return username === 'digger' ? conditionFieldIds(fieldsFixture) : null;
  }

  async getCollectionPage(username, page, fieldIds) {
    this.collectionCalls += 1;
    if (this.failWith) throw this.failWith;
    if (username !== 'digger') return null;
    const result = mapCollectionPage(collectionFixture, fieldIds);
    const items = [];
    for (let copy = 0; copy < this.collectionRepeat; copy += 1) {
      const shift = (page - 1) * 10_000 + copy * 10;
      items.push(...result.items.map((item) => ({ ...item, instanceId: item.instanceId + shift })));
    }
    return { ...result, page, pages: this.collectionPages, items };
  }
}

/** Remembers every live update instead of sending it, so tests can check them. */
export class RecordingLiveUpdates extends LiveUpdates {
  /** @type {number[]} */
  markets = [];
  /** @type {{ userId: number, message: object }[]} */
  messages = [];
  /** @type {string[]} */
  endedSessions = [];

  marketChanged(releaseId) {
    this.markets.push(releaseId);
  }

  notifyUser(userId, message) {
    this.messages.push({ userId, message });
  }

  sessionEnded(sessionId) {
    this.endedSessions.push(sessionId);
  }
}

export function createTestContext() {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL });
  const pool = createPool(TEST_DATABASE_URL);
  const catalogSource = new FakeCatalogSource();
  const catalog = new CatalogService({ pool, source: catalogSource, maxAgeMs: CATALOG_MAX_AGE_MS });
  const live = new RecordingLiveUpdates();
  const orders = new OrderService({ pool, catalog, live });
  const collection = new CollectionImport({ pool, source: catalogSource });
  return { config, pool, catalog, catalogSource, live, orders, collection };
}

/** Empty every table between tests (keeps the schema). */
export async function resetDatabase(pool) {
  await pool.query(`TRUNCATE users, sessions, releases, copies, copy_photos, orders, trades
     RESTART IDENTITY CASCADE`);
}
