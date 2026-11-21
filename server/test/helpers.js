/**
 * Test helpers: a context wired to the test database and a fake Discogs that
 * serves saved responses, so tests never call the real API.
 */
import { PricingService } from '../src/analytics/pricingService.js';
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
import { expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { LiveUpdates } from '../src/market/live.js';
import { OrderBook } from '../src/market/orderBook.js';
import { findBrokenRules } from '../src/orders/exchangeRules.js';
import { loadOpenOrders } from '../src/orders/orderRows.js';
import { CollectionImport } from '../src/collection/importService.js';
import { OrderService } from '../src/orders/orderService.js';
import { TradeService } from '../src/trades/tradeService.js';

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
  const trades = new TradeService({ pool, live });
  const collection = new CollectionImport({ pool, source: catalogSource });
  // No caching in tests: every request sees the data the test just wrote.
  const pricing = new PricingService({ pool, ttlMs: 0 });
  return { config, pool, catalog, catalogSource, live, orders, trades, collection, pricing };
}

/** Empty every table between tests (keeps the schema). */
export async function resetDatabase(pool) {
  await pool.query(`TRUNCATE users, sessions, releases, copies, copy_photos, orders, trades
     RESTART IDENTITY CASCADE`);
}

/** What a book holds, both sides, best first: for comparing two books. */
export const bookContents = (book) => ({ asks: book.asks(), bids: book.bids() });

/** A pressing's book exactly as the database's open orders build it. */
export async function bookFromDatabase(pool, releaseId) {
  const book = new OrderBook(releaseId);
  for (const order of (await loadOpenOrders(pool, releaseId)).get(releaseId) ?? []) {
    book.add(order);
  }
  return bookContents(book);
}

/**
 * Run after every market test (Part 7): the exchange's rules hold in the database, and
 * every current book the order service has in memory says the same as the database. A failure
 * lists the broken rules or shows the book that drifted.
 * @param {ReturnType<typeof createTestContext>} ctx
 */
export async function expectExchangeConsistent(ctx) {
  expect(await findBrokenRules(ctx.pool)).toEqual([]);
  for (const [releaseId, book] of ctx.orders.books) {
    // A book behind the database's version is never matched against: the next order
    // reloads it (OrderService.#transaction). Only a current book has to be exact.
    if (!(await ctx.orders.isCurrent(releaseId))) continue;
    expect(bookContents(book), `the book for ${releaseId}`).toEqual(
      await bookFromDatabase(ctx.pool, releaseId),
    );
  }
}
