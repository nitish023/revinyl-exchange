/**
 * Part 13: fair value per grade and the time-to-sale model, from the real database.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seedDemo } from '../src/db/seed.js';
import { createTestContext, expectExchangeConsistent, resetDatabase } from './helpers.js';
import { NM, RELEASE, traders, VG_PLUS } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { signUp, listCopy } = traders(ctx, app);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
  ctx.pricing.refresh();
});
afterEach(() => expectExchangeConsistent(ctx));
afterAll(() => ctx.pool.end());

const pricingOf = async (releaseId = RELEASE) =>
  (await request(app).get(`/api/releases/${releaseId}/pricing`).expect(200)).body.pricing;
const row = (pricing, grade) => pricing.fairValue.grades.find((g) => g.grade === grade);

async function sale(seller, buyer, price, grade = VG_PLUS) {
  const { order } = await listCopy(seller, price, grade);
  await buyer.post(`/api/orders/${order.id}/buy`, {}).expect(201);
}

describe('GET /api/releases/:id/pricing', () => {
  it('has no fair value for a pressing that never sold, but still the sale odds', async () => {
    const pricing = await pricingOf(12345);
    expect(pricing.fairValue).toBeNull();
    expect(pricing.odds).toMatchObject({ ads: 0, sold: 0 });
    expect(pricing.odds.beta).toBeLessThan(0);
  });

  it('prices every grade from the sales, with ranges, and says how much each grade adds', async () => {
    // Four different sellers: one pair trading four times would be set aside (Part 17).
    const buyer = await signUp('buyer');
    const sellers = await Promise.all(['sell1', 'sell2', 'sell3', 'sell4'].map((n) => signUp(n)));
    for (const [i, price] of ['38.00', '40.00', '42.00'].entries()) {
      await sale(sellers[i], buyer, price, VG_PLUS);
    }
    await sale(sellers[3], buyer, '55.00', NM);
    const pricing = await pricingOf();
    expect(pricing.fairValue.grades).toHaveLength(8);
    expect(pricing.fairValue).toMatchObject({ salesUsed: 4, outliers: 0, halfLifeDays: 30 });
    const vgPlus = row(pricing, VG_PLUS);
    expect(vgPlus).toMatchObject({ code: 'VG+', sales: 3 });
    expect(Number(vgPlus.fair)).toBeGreaterThan(37);
    expect(Number(vgPlus.fair)).toBeLessThan(44);
    expect(Number(vgPlus.low)).toBeLessThan(Number(vgPlus.fair));
    expect(Number(row(pricing, NM).fair)).toBeGreaterThan(Number(vgPlus.fair));
    expect(pricing.fairValue.gradeStep).toBeGreaterThan(0);
  });

  it('leaves refunded sales out', async () => {
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    await sale(seller, buyer, '40.00');
    const { order } = await listCopy(seller, '400.00');
    const { trade } = (await buyer.post(`/api/orders/${order.id}/buy`, {}).expect(201)).body;
    await seller.post(`/api/trades/${trade.id}/cancel`, {}).expect(200);
    expect((await pricingOf()).fairValue.salesUsed).toBe(1);
  });

  it('learns from the demo market: every past FOR SALE ad, sold or not', async () => {
    await seedDemo(ctx.pool);
    const pricing = await pricingOf();
    expect(pricing.fairValue.salesUsed).toBeGreaterThan(0);
    expect(pricing.odds.ads).toBeGreaterThan(0);
    expect(pricing.odds.sold).toBeLessThan(pricing.odds.ads); // the open ads are censored
  });

  it('refuses an id that isn’t a number', async () => {
    await request(app).get('/api/releases/abc/pricing').expect(400);
  });
});

describe('market surveillance (Part 17)', () => {
  const integrityOf = async () =>
    (await request(app).get(`/api/releases/${RELEASE}/integrity`).expect(200)).body.integrity;

  it('a copy pumped round a pair of friends is kept out of fair value, and reported', async () => {
    const [honestSeller, honestBuyer, ana, ben] = await Promise.all(
      ['seller', 'buyer', 'anna', 'benny'].map((name) => signUp(name)),
    );
    await sale(honestSeller, honestBuyer, '20.00');
    // Ana sells to Ben at $200, and Ben sells it straight back at $210.
    const { copy, order } = await listCopy(ana, '200.00');
    const { trade } = (await ben.post(`/api/orders/${order.id}/buy`, {}).expect(201)).body;
    await ana.post(`/api/trades/${trade.id}/ship`, {}).expect(200);
    await ben.post(`/api/trades/${trade.id}/received`, {}).expect(200);
    const back = (await ben.post('/api/orders', { side: 'ask', copyId: copy.id, price: '210' }))
      .body.order;
    await ana.post(`/api/orders/${back.id}/buy`, {}).expect(201);

    const pricing = await pricingOf();
    expect(pricing.fairValue.salesUsed).toBe(1); // only the honest $20 sale
    expect(Number(row(pricing, VG_PLUS).fair)).toBe(20);
    const integrity = await integrityOf();
    expect(integrity.checked).toBe(3);
    expect(integrity.washTrades.map((t) => [t.price, t.reasons])).toEqual([
      ['200.00', ['round_trip']],
      ['210.00', ['round_trip']],
    ]);
    expect(JSON.stringify(integrity)).not.toMatch(/anna|benny/);
  });

  it('finds nothing to set aside in the demo market', async () => {
    await seedDemo(ctx.pool);
    const { checked, washTrades, outliers } = await integrityOf();
    expect(checked).toBeGreaterThan(0);
    expect({ washTrades, outliers }).toEqual({ washTrades: [], outliers: [] });
  });

  it('reports a sale the fair value fit set aside as an outlier', async () => {
    const buyer = await signUp('buyer');
    const sellers = await Promise.all(
      ['seller1', 'seller2', 'seller3', 'seller4', 'seller5'].map((n) => signUp(n)),
    );
    for (const [i, price] of ['40.00', '41.00', '39.00', '40.50', '400.00'].entries()) {
      await sale(sellers[i], buyer, price);
    }
    const { outliers, washTrades } = await integrityOf();
    expect(outliers.map((sale) => sale.price)).toEqual(['400.00']);
    expect(washTrades).toEqual([]);
  });
});

describe('GET /api/releases/:id/history (Part 14)', () => {
  const historyOf = async () =>
    (await request(app).get(`/api/releases/${RELEASE}/history`).expect(200)).body.history;

  it('is empty for a pressing nobody has traded', async () => {
    expect(await historyOf()).toEqual({
      candles: [],
      stats: {
        monthlyVolatility: null,
        change30: null,
        high52: null,
        low52: null,
        lastClose: null,
      },
      depth: [],
    });
  });

  it('turns today’s sales into one candle in VG+ terms, and the open ads into depth', async () => {
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    await sale(seller, buyer, '40.00');
    await sale(seller, buyer, '30.00');
    await listCopy(seller, '45.00');
    await listCopy(seller, '50.00');
    await buyer.post('/api/orders', { side: 'bid', releaseId: RELEASE, price: '25', minGrade: 1 });
    const { candles, stats, depth } = await historyOf();
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      open: '40.00',
      close: '30.00',
      high: '40.00',
      low: '30.00',
      sales: 2,
    });
    expect(stats.lastClose).toBe('30.00');
    expect(stats.monthlyVolatility).toBeNull(); // one day of sales
    // The wanted ad takes any grade, so it's in every grade's book; the copies are VG+.
    expect(depth.map((book) => book.code)).toEqual(['P', 'F', 'G', 'G+', 'VG', 'VG+', 'NM', 'M']);
    const vgPlus = depth.find((book) => book.code === 'VG+');
    expect(vgPlus.asks).toEqual([
      { price: '45.00', copies: 1 },
      { price: '50.00', copies: 2 },
    ]);
    expect(vgPlus.bids).toEqual([{ price: '25.00', copies: 1 }]);
    expect(vgPlus.spread).toEqual({ bid: '25.00', ask: '45.00', amount: '20.00', share: 20 / 45 });
    expect(depth.find((book) => book.code === 'NM')).toMatchObject({ asks: [], spread: null });
  });

  it('charts the demo month', async () => {
    await seedDemo(ctx.pool);
    const { candles, stats } = await historyOf();
    expect(candles.length).toBeGreaterThan(3);
    expect(candles.map((c) => c.day)).toEqual([...candles.map((c) => c.day)].sort());
    expect(stats.monthlyVolatility).toBeGreaterThan(0);
  });
});
