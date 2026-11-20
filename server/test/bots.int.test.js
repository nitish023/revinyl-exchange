/**
 * Part 19: the market-making bots against the real database. They trade through the same
 * services as everyone, so every test ends with the exchange's rules checked.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { BOT_NAMES } from '../src/bots/botService.js';
import { mapRelease } from '../src/catalog/discogsMapping.js';
import releaseFixture from '../src/catalog/fixtures/release-249504.json' with { type: 'json' };
import { upsertRelease } from '../src/catalog/releasesRepo.js';
import { simulateHistory } from '../src/sim/history.js';
import { createTestContext, expectExchangeConsistent, resetDatabase } from './helpers.js';
import { RELEASE, traders, VG_PLUS } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { query, signUp, listCopy } = traders(ctx, app);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
  ctx.pricing.refresh();
});
afterEach(() => expectExchangeConsistent(ctx));
afterAll(() => ctx.pool.end());

/** A few honest sales of VG+ copies around $40, so the pressing has a fair value. */
async function aMarket() {
  const buyer = await signUp('buyer');
  for (const [i, price] of ['38.00', '40.00', '42.00'].entries()) {
    const seller = await signUp(`seller${i + 1}`);
    const { order } = await listCopy(seller, price);
    const { trade } = (await buyer.post(`/api/orders/${order.id}/buy`, {}).expect(201)).body;
    await seller.post(`/api/trades/${trade.id}/ship`, {}).expect(200);
    await buyer.post(`/api/trades/${trade.id}/received`, {}).expect(200);
  }
  return buyer;
}

const botOrders = () =>
  query(
    `SELECT o.id, o.side, o.price_cents, u.display_name FROM orders o JOIN users u ON u.id = o.user_id
      WHERE u.is_bot AND o.status = 'open' ORDER BY o.side, o.id`,
  );

describe('simulated history (npm run db:simulate)', () => {
  it('writes months of clean, consistent sales that the index and the charts can use', async () => {
    await upsertRelease(ctx.pool, mapRelease(releaseFixture), new Date());
    const result = await simulateHistory(ctx.pool, { days: 60 });
    expect(result.pressings).toBe(1);
    expect(result.sales).toBeGreaterThan(30);
    // Surveillance finds nothing to set aside: every copy moves on, no pair churns.
    const { integrity } = (await request(app).get(`/api/releases/${RELEASE}/integrity`).expect(200))
      .body;
    expect(integrity.washTrades).toEqual([]);
    const { history } = (await request(app).get(`/api/releases/${RELEASE}/history`).expect(200))
      .body;
    expect(history.candles.length).toBeGreaterThan(20);
    // A believable market: it moves, but not wildly.
    expect(history.stats.monthlyVolatility).toBeGreaterThan(0);
    expect(history.stats.monthlyVolatility).toBeLessThan(0.5);
    const { index } = (await request(app).get('/api/index').expect(200)).body;
    expect(index.series.length).toBeGreaterThan(50);
    // Runs once.
    expect(await simulateHistory(ctx.pool, { days: 60 })).toBeNull();
  });
});

describe('the market-making bots', () => {
  it('are users flagged as bots, made once', async () => {
    await ctx.bots.ensureBots();
    await ctx.bots.ensureBots();
    const bots = await query('SELECT display_name, is_bot FROM users WHERE is_bot ORDER BY id');
    expect(bots.map((b) => b.display_name)).toEqual([...BOT_NAMES]);
  });

  it('do nothing on a market with no sales to price from', async () => {
    expect(await ctx.bots.tick()).toEqual({ chores: 0, quotes: 0 });
  });

  it('quote a WANTED ad under fair value and a FOR SALE ad over it', async () => {
    await aMarket();
    expect(await ctx.bots.tick()).toMatchObject({ quotes: 2 });
    const [ask, bid] = await botOrders();
    expect(ask.side).toBe('ask');
    expect(bid.side).toBe('bid');
    const fair = Number(
      (await request(app).get(`/api/releases/${RELEASE}/pricing`).expect(200)).body.pricing
        .fairValue.grades[VG_PLUS - 1].fair,
    );
    expect(bid.price_cents / 100).toBeLessThan(fair);
    expect(ask.price_cents / 100).toBeGreaterThan(fair);
  });

  it('the mean-reversion trader buys a dip, and stays out while prices are normal', async () => {
    const buyer = await aMarket();
    await ctx.bots.tick();
    const satoOrders = () =>
      query(
        `SELECT o.side, o.price_cents FROM orders o JOIN users u ON u.id = o.user_id
          WHERE u.display_name = 'desk_sato' AND o.status = 'open'`,
      );
    expect(await satoOrders()).toEqual([]); // the last sale was $42: nothing unusual
    // A VG+ copy goes for $25, far under fair value: a hasty seller answers a collector's
    // low WANTED ad. (Listed for $25, it would have sold to the market maker's higher bid:
    // the maker absorbs dips, exactly as the simulation shows.)
    const { order: lowBid } = (
      await buyer
        .post('/api/orders', { side: 'bid', releaseId: RELEASE, price: '25', minGrade: VG_PLUS })
        .expect(201)
    ).body;
    const seller = await signUp('hasty');
    const copy = (
      await seller
        .post('/api/crate', { releaseId: RELEASE, grade: VG_PLUS, sleeveGrade: VG_PLUS })
        .expect(201)
    ).body.copy;
    await seller.post(`/api/orders/${lowBid.id}/sell`, { copyId: copy.id }).expect(201);
    await ctx.bots.tick();
    expect(await satoOrders()).toEqual([{ side: 'bid', price_cents: 2550 }]); // $25 + 2%
  });

  it('leave their ads alone while the quote hasn’t moved', async () => {
    await aMarket();
    await ctx.bots.tick();
    const before = (await botOrders()).map((o) => o.id);
    expect(await ctx.bots.tick()).toMatchObject({ quotes: 0 });
    expect((await botOrders()).map((o) => o.id)).toEqual(before);
  });

  it('ship what they sell, and accept what they buy once it’s shipped', async () => {
    const buyer = await aMarket();
    await ctx.bots.tick();
    const [ask, bid] = await botOrders();
    // A collector buys the bot's copy; another sells it one.
    const { trade: bought } = (await buyer.post(`/api/orders/${ask.id}/buy`, {}).expect(201)).body;
    const seller = await signUp('collector');
    const copy = (
      await seller
        .post('/api/crate', { releaseId: RELEASE, grade: VG_PLUS, sleeveGrade: VG_PLUS })
        .expect(201)
    ).body.copy;
    const { trade: sold } = (
      await seller.post(`/api/orders/${bid.id}/sell`, { copyId: copy.id }).expect(201)
    ).body;

    await ctx.bots.tick();
    const status = async (id) =>
      (await query('SELECT status FROM trades WHERE id = $1', [id]))[0].status;
    expect(await status(bought.id)).toBe('shipped'); // the bot shipped it
    expect(await status(sold.id)).toBe('awaiting_shipment'); // waiting for the collector
    await seller.post(`/api/trades/${sold.id}/ship`, {}).expect(200);
    await ctx.bots.tick();
    expect(await status(sold.id)).toBe('completed'); // the bot accepted it
  });

  it('are labelled on the market, as sellers and as buyers', async () => {
    await aMarket();
    await ctx.bots.tick();
    const { market } = (await request(app).get(`/api/releases/${RELEASE}/market`).expect(200)).body;
    const ads = market.forSale.flatMap((group) => group.ads);
    expect(ads.find((ad) => ad.seller.bot)).toMatchObject({
      seller: { name: expect.stringMatching(/^desk_/), bot: true },
    });
    expect(market.wanted.find((ad) => ad.buyer.bot)).toBeTruthy();
  });
});
