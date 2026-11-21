/**
 * Part 7: the exchange's rules, checked against the database (exchangeRules.js), and what
 * a restarted server rebuilds (recovery.js, OrderService.recover). Each test starts from an
 * empty database. "Restarting" makes a fresh OrderService on the same database: everything
 * the old one had in memory is gone, exactly as after a deploy or a crash.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/db/seed.js';
import { OrderBook } from '../src/market/orderBook.js';
import { findBrokenRules } from '../src/orders/exchangeRules.js';
import { OrderService } from '../src/orders/orderService.js';
import { recoverExchange } from '../src/recovery.js';
import {
  bookContents as contents,
  bookFromDatabase,
  createTestContext,
  resetDatabase,
} from './helpers.js';
import { RELEASE, traders, VG, VG_PLUS } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { signUp, addCopy, listCopy, placeBid, walletOf, copyStatus, hookQueries } = traders(
  ctx,
  app,
);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => ctx.pool.end());

const buy = (user, orderId) => user.post(`/api/orders/${orderId}/buy`, {});
const step = (user, tradeId, name) => user.post(`/api/trades/${tradeId}/${name}`, {});
const quiet = () => ({ log: vi.fn(), error: vi.fn() });

/** A new server process on the same database: an order service with nothing in memory. */
function restart() {
  return {
    pool: ctx.pool,
    orders: new OrderService({ pool: ctx.pool, catalog: ctx.catalog, live: ctx.live }),
  };
}

/**
 * A bit of everything: an open FOR SALE ad and an open WANTED ad that don't cross, a
 * cancelled ad, a trade waiting to ship and a completed one.
 */
async function busyExchange() {
  const [ana, ben, cy] = await Promise.all(['anna', 'benny', 'cyrus'].map((name) => signUp(name)));
  const forSale = await listCopy(ana, '50.00');
  const { order: wanted } = (await placeBid(ben, '20.00', VG_PLUS).expect(201)).body;
  const { order: cancelled } = (await placeBid(cy, '10.00', VG_PLUS).expect(201)).body;
  await cy.del(`/api/orders/${cancelled.id}`).expect(200);

  const waiting = await listCopy(ana, '30.00');
  const { trade: unsettled } = (await buy(cy, waiting.order.id).expect(201)).body;

  const sold = await listCopy(ana, '40.00');
  const { trade: completed } = (await buy(ben, sold.order.id).expect(201)).body;
  await step(ana, completed.id, 'ship').expect(200);
  await step(ben, completed.id, 'received').expect(200);

  return { ana, ben, cy, forSale, wanted, cancelled, waiting, unsettled, completed };
}

/** Break the data on purpose inside a transaction, check the rules, then undo it. */
async function brokenAfter(sql, params) {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql, params);
    return await findBrokenRules(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('the exchange rules (findBrokenRules)', () => {
  it('hold on an empty exchange', async () => {
    expect(await findBrokenRules(ctx.pool)).toEqual([]);
  });

  it('hold on the demo data', async () => {
    await seedDemo(ctx.pool);
    expect(await findBrokenRules(ctx.pool)).toEqual([]);
  });

  it('hold after a mix of everything: matches, buys, cancels, refunds, completed trades', async () => {
    const { ana, cy } = await busyExchange();
    const dee = await signUp('delia');
    // Refunded after shipping, and cancelled by the seller before shipping.
    const shipped = (await buy(dee, (await listCopy(cy, '22.00')).order.id).expect(201)).body;
    await step(cy, shipped.trade.id, 'ship').expect(200);
    await step(dee, shipped.trade.id, 'refund').expect(200);
    const backedOut = (await buy(dee, (await listCopy(ana, '55.00')).order.id).expect(201)).body;
    await step(ana, backedOut.trade.id, 'cancel').expect(200);
    // Sell to them, with a copy that was already for sale.
    const { order: wantedByDee } = (await placeBid(dee, '45.00', VG).expect(201)).body;
    const listed = await listCopy(cy, '60.00');
    await cy.post(`/api/orders/${wantedByDee.id}/sell`, { copyId: listed.copy.id }).expect(201);

    expect(await findBrokenRules(ctx.pool)).toEqual([]);
  });

  // Each one breaks the data the way a bug or a careless hand fix could, and is caught by
  // exactly the rules listed (space-separated, in the order they're checked).
  it.each([
    [
      'ledgerBalanced money escrowMatchesTrades',
      'a ledger entry is added that doesn’t balance',
      () => [
        `INSERT INTO ledger_entries (journal_id, account, amount_cents)
         SELECT max(id), 'escrow', 100 FROM ledger_journals`,
        [],
      ],
    ],
    [
      'money cashMatchesLedger',
      'a user is given $1 from nowhere',
      (s) => ['UPDATE users SET cash_cents = cash_cents + 100 WHERE id = $1', [s.ana.id]],
    ],
    [
      'holds',
      'held cash no longer matches the open WANTED ads',
      (s) => ['UPDATE users SET held_cents = held_cents + 100 WHERE id = $1', [s.ben.id]],
    ],
    [
      'listedCopies',
      'a copy for sale is marked as in the crate',
      (s) => [`UPDATE copies SET status = 'in_crate' WHERE id = $1`, [s.forSale.copy.id]],
    ],
    [
      'askOwners',
      'a copy for sale changes owner',
      (s) => ['UPDATE copies SET owner_id = $2 WHERE id = $1', [s.forSale.copy.id, s.cy.id]],
    ],
    [
      'copiesInTrades',
      'a copy in a trade is marked as in the crate',
      (s) => [`UPDATE copies SET status = 'in_crate' WHERE id = $1`, [s.waiting.copy.id]],
    ],
    [
      'tradeCopies',
      'a copy in an unsettled trade moves to the buyer early',
      (s) => ['UPDATE copies SET owner_id = $2 WHERE id = $1', [s.waiting.copy.id, s.cy.id]],
    ],
    [
      'filledOrders',
      'a cancelled order is marked filled with no trade',
      (s) => [`UPDATE orders SET status = 'filled' WHERE id = $1`, [s.cancelled.id]],
    ],
    [
      'tradeJournals tradesMatchOrders',
      'a trade’s price is more than the buyer offered',
      (s) => ['UPDATE trades SET price_cents = price_cents + 100 WHERE id = $1', [s.completed.id]],
    ],
    [
      'uncrossed',
      'a FOR SALE ad drops below an open WANTED ad’s price',
      (s) => ['UPDATE orders SET price_cents = 1500 WHERE id = $1', [s.forSale.order.id]],
    ],
  ])('%s catches it when %s', async (rules, _what, breakIt) => {
    const state = await busyExchange();
    expect(await findBrokenRules(ctx.pool)).toEqual([]);
    const broken = await brokenAfter(...breakIt(state));
    expect(broken.map((problem) => problem.rule)).toEqual(rules.split(' '));
    expect(broken[0].detail).toMatch(/\d/); // names the ids or amounts to look at
  });
});

describe('restarting the server (recoverExchange)', () => {
  it('rebuilds the same order books from the database', async () => {
    await busyExchange();
    const before = contents(await ctx.orders.book(RELEASE));
    expect(before.asks).toHaveLength(1);
    expect(before.bids).toHaveLength(1);

    const restarted = restart();
    const log = quiet();
    const summary = await recoverExchange(restarted, log);
    expect(summary).toEqual({ broken: [], books: 1, orders: 2, failed: [] });
    expect(contents(restarted.orders.books.get(RELEASE))).toEqual(before);
    expect(log.log).toHaveBeenCalledWith('[orders] rebuilt 1 order books from 2 open orders');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('keeps who was first: equal prices still fill oldest first, at the resting price', async () => {
    const [ana, ben, cy, dee] = await Promise.all(
      ['anna', 'benny', 'cyrus', 'delia'].map((name) => signUp(name)),
    );
    const older = await listCopy(ana, '25.00');
    await listCopy(ben, '25.00');
    const olderBid = (await placeBid(cy, '18.00', VG_PLUS).expect(201)).body.order;
    await placeBid(dee, '18.00', VG_PLUS).expect(201);

    const restarted = restart();
    await recoverExchange(restarted, quiet());

    // A buyer after the restart gets the older of the two $25 copies.
    const bought = await restarted.orders.place(
      { id: dee.id },
      { side: 'bid', releaseId: RELEASE, price: '30.00', minGrade: VG_PLUS },
    );
    expect(bought.trade).toMatchObject({ copyId: older.copy.id, price: '25.00' });
    // A seller after the restart fills the older of the two $18 wanted ads, at $18.
    const copy = await addCopy(ben);
    const sold = await restarted.orders.place(
      { id: ben.id },
      { side: 'ask', copyId: copy.id, price: '15.00' },
    );
    expect(sold.trade).toMatchObject({ copyId: copy.id, price: '18.00' });
    const { rows } = await ctx.pool.query('SELECT bid_order_id FROM trades WHERE id = $1', [
      sold.trade.id,
    ]);
    expect(rows[0].bid_order_id).toBe(olderBid.id);

    expect(contents(restarted.orders.books.get(RELEASE))).toEqual(
      await bookFromDatabase(ctx.pool, RELEASE),
    );
    expect(await findBrokenRules(ctx.pool)).toEqual([]);
  });

  it('a trade that failed halfway leaves nothing behind, and the ad can still be bought after', async () => {
    const [ana, ben] = await Promise.all(['anna', 'benny'].map((name) => signUp(name)));
    const { copy, order: ask } = await listCopy(ana, '40.00');
    const walletBefore = await walletOf(ben);

    // The server dies while saving the trade: the transaction never commits.
    hookQueries((sql) => (sql.includes('INSERT INTO trades') ? 'fail' : null));
    await placeBid(ben, '40.00', VG_PLUS).expect(500);
    vi.restoreAllMocks();

    const restarted = restart();
    const summary = await recoverExchange(restarted, quiet());
    expect(summary).toMatchObject({ broken: [], books: 1, orders: 1 });
    expect(contents(restarted.orders.books.get(RELEASE)).asks.map((a) => a.id)).toEqual([ask.id]);
    expect(await walletOf(ben)).toEqual(walletBefore);
    expect(await copyStatus(copy.id)).toBe('listed');

    const { trade } = await restarted.orders.place(
      { id: ben.id },
      { side: 'bid', releaseId: RELEASE, price: '40.00', minGrade: VG_PLUS },
    );
    expect(trade).toMatchObject({ copyId: copy.id, price: '40.00', status: 'awaiting_shipment' });
    expect(await findBrokenRules(ctx.pool)).toEqual([]);
  });

  it('says loudly which rules are broken, and still rebuilds the books', async () => {
    const { ana } = await busyExchange();
    await ctx.pool.query('UPDATE users SET cash_cents = cash_cents + 100 WHERE id = $1', [ana.id]);

    const log = quiet();
    const summary = await recoverExchange(restart(), log);
    expect(summary.broken.map((problem) => problem.rule)).toEqual(['money', 'cashMatchesLedger']);
    expect(summary.books).toBe(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/^\[check\] money: /));
    expect(log.error).toHaveBeenCalledWith('[check] 2 problems found; see above');
  });

  it('leaves out a pressing whose orders the engine refuses, so it stops trading until fixed', async () => {
    const { wanted, cy } = await busyExchange();
    const add = OrderBook.prototype.add;
    vi.spyOn(OrderBook.prototype, 'add').mockImplementation(function (order) {
      if (order.id === wanted.id) throw new Error(`Order ${order.id} is broken`);
      return add.call(this, order);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const restarted = restart();
    const log = quiet();
    const summary = await recoverExchange(restarted, log);
    expect(summary).toMatchObject({ books: 0, orders: 0, failed: [RELEASE] });
    expect(restarted.orders.books.has(RELEASE)).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      `[orders] these pressings can't trade until fixed: ${RELEASE}`,
    );
    const order = { side: 'bid', releaseId: RELEASE, price: '12.00', minGrade: VG_PLUS };
    await expect(restarted.orders.place({ id: cy.id }, order)).rejects.toThrow(/is broken/);

    // Once it's fixed (here: the engine stops refusing), the next order loads the book.
    vi.restoreAllMocks();
    const { order: placed } = await restarted.orders.place({ id: cy.id }, order);
    expect(placed.status).toBe('open');
    expect(await findBrokenRules(ctx.pool)).toEqual([]);
  });
});
