/**
 * Part 7: concurrency and property-based tests against the real database.
 * Spec: docs/parts/part-7-recovery.md.
 *
 * Two order services share one database here, like two server processes behind a load
 * balancer: each has its own in-memory books and its own pressing queues, so only the
 * database (advisory locks, row locks, book versions) keeps them honest. After every run the
 * exchange's rules must hold and every current book must equal the database's.
 */
import fc from 'fast-check';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { mapRelease } from '../src/catalog/discogsMapping.js';
import releaseFixture from '../src/catalog/fixtures/release-249504.json' with { type: 'json' };
import { upsertRelease } from '../src/catalog/releasesRepo.js';
import { createPool } from '../src/db/pool.js';
import { AppError } from '../src/errors.js';
import { findBrokenRules } from '../src/orders/exchangeRules.js';
import { OrderService } from '../src/orders/orderService.js';
import { traders as tradersOf } from './traders.js';
import {
  bookContents,
  bookFromDatabase,
  createTestContext,
  resetDatabase,
  TEST_DATABASE_URL,
} from './helpers.js';

const RELEASE = releaseFixture.id;
const OTHER = 1234;
const PRESSINGS = [RELEASE, OTHER];
const TRADERS = 4;

const ctx = createTestContext();
// The second "process": its own connection pool and its own order service.
const secondPool = createPool(TEST_DATABASE_URL);
const processes = [
  ctx.orders,
  new OrderService({ pool: secondPool, catalog: ctx.catalog, live: ctx.live }),
];

afterAll(async () => {
  await ctx.pool.end();
  await secondPool.end();
});

const query = async (sql, params) => (await ctx.pool.query(sql, params)).rows;

/** An empty exchange with both pressings, TRADERS traders and a few copies each. */
async function freshExchange({ copiesEach = 3 } = {}) {
  await resetDatabase(ctx.pool);
  for (const service of processes) service.books.clear();
  await upsertRelease(ctx.pool, mapRelease(releaseFixture), new Date());
  await query(
    `INSERT INTO releases (id, title, artist, discogs_url) VALUES ($1, 'Other', 'Someone', $2)`,
    [OTHER, `https://www.discogs.com/release/${OTHER}`],
  );
  const users = await query(
    `INSERT INTO users (email, display_name, password_hash)
     SELECT 'trader' || n || '@example.com', 'trader' || n, 'not-a-login'
       FROM generate_series(1, $1) n
     RETURNING id`,
    [TRADERS],
  );
  // Grades 4 to 8, spread over both pressings.
  await query(
    `INSERT INTO copies (owner_id, release_id, grade)
     SELECT u.id, CASE WHEN n % 2 = 0 THEN $2::bigint ELSE $3::bigint END, 4 + (u.id + n) % 5
       FROM unnest($1::bigint[]) u(id), generate_series(1, $4) n`,
    [users.map((user) => user.id), RELEASE, OTHER, copiesEach * 2],
  );
  return users.map((user) => ({ id: user.id }));
}

/** Refusals are fine (someone else got there first); anything else is a bug. */
async function expectOnlyRefusals(work) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return { ok: false, code: error.code };
    throw error;
  }
}

/** The rules hold, and every book each process holds at the current version is exact. */
async function expectConsistent() {
  expect(await findBrokenRules(ctx.pool)).toEqual([]);
  for (const service of processes) {
    for (const releaseId of PRESSINGS) {
      if (!service.books.has(releaseId) || !(await service.isCurrent(releaseId))) continue;
      expect(bookContents(service.books.get(releaseId))).toEqual(
        await bookFromDatabase(ctx.pool, releaseId),
      );
    }
  }
}

const pick = (list, seed) => (list.length ? list[seed % list.length] : null);

/**
 * One random action. The generated numbers are "seeds": which open ad, copy or trade they
 * point at is decided when the action runs, from whatever is in the database by then, so
 * actions in the same batch race for the same things.
 */
async function act(action, traders) {
  const user = traders[action.trader % traders.length];
  const service = processes[action.process];
  const releaseId = PRESSINGS[action.pressing];
  const price = String(action.dollars);
  switch (action.kind) {
    case 'bid':
      // Part 15: one in three rises to stay the best offer, up to $10 more.
      return service.place(user, {
        side: 'bid',
        releaseId,
        price,
        minGrade: action.grade,
        ...(action.seed % 3 === 0 && {
          repriceStep: '1',
          repriceLimit: String(action.dollars + 10),
        }),
      });
    case 'list': {
      const copies = await query(
        `SELECT id FROM copies WHERE owner_id = $1 AND release_id = $2 AND status = 'in_crate'
          ORDER BY id`,
        [user.id, releaseId],
      );
      const copy = pick(copies, action.seed);
      // Part 15: one in three follows cheaper rivals down, to $10 less (at least $1).
      return (
        copy &&
        service.place(user, {
          side: 'ask',
          copyId: copy.id,
          price,
          ...(action.seed % 3 === 0 && {
            repriceStep: '1',
            repriceLimit: String(Math.max(1, action.dollars - 10)),
          }),
        })
      );
    }
    case 'expire': {
      // Part 15: an ad's time runs out, and one of the processes sweeps.
      const open = await query(`SELECT id FROM orders WHERE status = 'open' ORDER BY id`);
      const order = pick(open, action.seed);
      if (order) {
        await query(
          `UPDATE orders SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
            WHERE id = $1 AND status = 'open'`,
          [order.id],
        );
      }
      return service.sweepExpired();
    }
    case 'auction': {
      // Part 16: put a copy from the crate up for a sealed-bid auction.
      const copies = await query(
        `SELECT id FROM copies WHERE owner_id = $1 AND status = 'in_crate' ORDER BY id`,
        [user.id],
      );
      const copy = pick(copies, action.seed);
      return copy && ctx.auctions.start(user, { copyId: copy.id, reserve: price, days: 1 });
    }
    case 'auctionBid': {
      const open = await query(`SELECT id FROM auctions WHERE status = 'open' ORDER BY id`);
      const auction = pick(open, action.seed);
      return auction && ctx.auctions.bid(user, auction.id, { amount: price });
    }
    case 'auctionEnd': {
      const open = await query(`SELECT id FROM auctions WHERE status = 'open' ORDER BY id`);
      const auction = pick(open, action.seed);
      if (auction) {
        await query(
          `UPDATE auctions SET created_at = now() - interval '2 days', ends_at = now() - interval '1 minute'
            WHERE id = $1 AND status = 'open'`,
          [auction.id],
        );
      }
      return ctx.auctions.settleDue();
    }
    case 'buy': {
      const asks = await query(
        `SELECT id FROM orders WHERE side = 'ask' AND status = 'open' AND user_id <> $1
          ORDER BY id`,
        [user.id],
      );
      const ask = pick(asks, action.seed);
      return ask && service.buy(user, ask.id);
    }
    case 'sell': {
      const bids = await query(
        `SELECT id, release_id FROM orders WHERE side = 'bid' AND status = 'open' AND user_id <> $1
          ORDER BY id`,
        [user.id],
      );
      const bid = pick(bids, action.seed);
      if (!bid) return null;
      const copies = await query(
        `SELECT id FROM copies WHERE owner_id = $1 AND release_id = $2
            AND status IN ('in_crate', 'listed') ORDER BY id`,
        [user.id, bid.release_id],
      );
      const copy = pick(copies, action.grade);
      return copy && service.sellTo(user, bid.id, { copyId: copy.id });
    }
    case 'cancel': {
      const mine = await query(
        `SELECT id FROM orders WHERE user_id = $1 AND status = 'open' ORDER BY id`,
        [user.id],
      );
      const order = pick(mine, action.seed);
      return order && service.cancel(user, order.id);
    }
    case 'step': {
      const trades = await query(
        `SELECT id, buyer_id, seller_id, status FROM trades
          WHERE status IN ('awaiting_shipment', 'shipped') ORDER BY id`,
      );
      const trade = pick(trades, action.seed);
      if (!trade) return null;
      // Usually a step that fits (seller ships or cancels, buyer accepts or refunds), and
      // one time in five the other person tries it: both must be handled.
      const [step, by] =
        trade.status === 'awaiting_shipment'
          ? [action.dollars % 4 ? 'ship' : 'cancel', 'seller']
          : [action.dollars % 4 ? 'received' : 'refund', 'buyer'];
      const wrongPerson = action.grade % 5 === 0;
      const actor = { id: trade[`${(by === 'seller') !== wrongPerson ? 'seller' : 'buyer'}_id`] };
      return ctx.trades[step](actor, trade.id);
    }
    default:
      throw new Error(`Unknown action ${action.kind}`);
  }
}

const actionArb = fc.record({
  kind: fc.constantFrom(
    'bid',
    'list',
    'list',
    'buy',
    'sell',
    'cancel',
    'step',
    'step',
    'expire',
    'auction',
    'auctionBid',
    'auctionBid',
    'auctionEnd',
  ),
  trader: fc.nat({ max: TRADERS - 1 }),
  process: fc.nat({ max: 1 }),
  pressing: fc.nat({ max: 1 }),
  dollars: fc.integer({ min: 1, max: 40 }),
  grade: fc.integer({ min: 1, max: 8 }),
  seed: fc.nat(),
});

describe('two server processes on one database', () => {
  it('a process whose book is behind reloads it before matching, so nothing is missed', async () => {
    const [ana, ben] = await freshExchange();
    const [first, second] = processes;
    // The first process loads the pressing's book (with one low WANTED ad of Ana's).
    await first.place(ana, { side: 'bid', releaseId: RELEASE, price: '5', minGrade: 1 });
    expect(await first.isCurrent(RELEASE)).toBe(true);
    // The second process adds a WANTED ad the first one has never seen.
    const { order: wanted } = await second.place(ben, {
      side: 'bid',
      releaseId: RELEASE,
      price: '30',
      minGrade: 1,
    });
    expect(await first.isCurrent(RELEASE)).toBe(false);
    // A seller on the first process must still fill it, not rest beside it.
    const [copy] = await query(
      `SELECT id FROM copies WHERE owner_id = $1 AND release_id = $2 LIMIT 1`,
      [ana.id, RELEASE],
    );
    const sold = await first.place(ana, { side: 'ask', copyId: copy.id, price: '20' });
    expect(sold.trade).toMatchObject({ price: '30.00', copyId: copy.id });
    const [{ bid_order_id: filled }] = await query(
      'SELECT bid_order_id FROM trades WHERE id = $1',
      [sold.trade.id],
    );
    expect(filled).toBe(wanted.id);
    await expectConsistent();
  });

  it('fifteen buyers on two processes press Buy on one copy: exactly one gets it', async () => {
    const traders = await freshExchange({ copiesEach: 1 });
    const extra = await query(
      `INSERT INTO users (email, display_name, password_hash)
       SELECT 'buyer' || n || '@example.com', 'buyer' || n, 'not-a-login'
         FROM generate_series(1, 15) n RETURNING id`,
    );
    const [copy] = await query(
      `SELECT id FROM copies WHERE owner_id = $1 AND release_id = $2 LIMIT 1`,
      [traders[0].id, RELEASE],
    );
    const { order: ask } = await processes[0].place(traders[0], {
      side: 'ask',
      copyId: copy.id,
      price: '25',
    });

    const results = await Promise.all(
      extra.map((buyer, i) => expectOnlyRefusals(() => processes[i % 2].buy(buyer, ask.id))),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(new Set(results.filter((r) => !r.ok).map((r) => r.code))).toEqual(
      new Set(['TARGET_UNAVAILABLE']),
    );
    expect(await query('SELECT count(*)::int AS n FROM trades')).toEqual([{ n: 1 }]);
    await expectConsistent();
  });

  it('every seller answers one WANTED ad at once: exactly one sale, one hold released', async () => {
    const traders = await freshExchange({ copiesEach: 2 });
    const [buyer, ...sellers] = traders;
    const { order: wanted } = await processes[1].place(buyer, {
      side: 'bid',
      releaseId: RELEASE,
      price: '35',
      minGrade: 1,
    });
    const attempts = [];
    for (const [i, seller] of sellers.entries()) {
      const copies = await query('SELECT id FROM copies WHERE owner_id = $1 AND release_id = $2', [
        seller.id,
        RELEASE,
      ]);
      for (const copy of copies) {
        attempts.push(() => processes[i % 2].sellTo(seller, wanted.id, { copyId: copy.id }));
      }
    }
    const results = await Promise.all(attempts.map(expectOnlyRefusals));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const [wallet] = await query('SELECT held_cents FROM users WHERE id = $1', [buyer.id]);
    expect(wallet.held_cents).toBe(0);
    await expectConsistent();
  });
});

describe('deadlocks', () => {
  it('a purchase and a trade step between the same two people, at the same moment, both finish', async () => {
    // What the random flow found: the purchase locks the buyer's wallet and then saves a
    // trade, whose foreign key check needs the seller's users row; meanwhile the seller
    // cancels an older sale to the same buyer, locking the seller's wallet and then the
    // buyer's. With FOR UPDATE wallet locks, each waited for the other.
    await freshExchange({ copiesEach: 0 });
    const app = createApp(ctx, { rateLimit: false });
    const { signUp, listCopy, placeBid, hookQueries } = tradersOf(ctx, app);
    const seller = await signUp('sella'); // signs up first: the lower id, locked first
    const buyer = await signUp('buyer');
    const older = await listCopy(seller, '20.00');
    const { trade } = (await buyer.post(`/api/orders/${older.order.id}/buy`, {}).expect(201)).body;
    await listCopy(seller, '25.00');

    // Hold the purchase between its wallet lock and the trade it saves.
    hookQueries((sql) => (sql.includes('INSERT INTO orders') ? 300 : null));
    const purchase = placeBid(buyer, '25.00', 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cancel = seller.post(`/api/trades/${trade.id}/cancel`, {});
    const [bought, cancelled] = await Promise.all([purchase, cancel]);
    vi.restoreAllMocks();

    expect(bought.status).toBe(201);
    expect(bought.body.trade).toMatchObject({ price: '25.00' });
    expect(cancelled.status).toBe(200);
    await expectConsistent();
  });
});

describe('random order flow, many at once (property-based)', () => {
  it('whatever happens, in whatever order, the exchange still adds up', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(actionArb, { minLength: 1, maxLength: 10 }), {
          minLength: 1,
          maxLength: 12,
        }),
        async (batches) => {
          const traders = await freshExchange();
          for (const batch of batches) {
            // Everything in a batch runs at the same time, across both processes.
            await Promise.all(
              batch.map((action) => expectOnlyRefusals(() => act(action, traders))),
            );
          }
          await expectConsistent();
        },
      ),
      // No shrinking: each run resets the database, so a shrink would take minutes. The
      // counterexample printed is the whole failing run.
      { numRuns: 25, endOnFailure: true },
    );
  }, 120_000);
});
