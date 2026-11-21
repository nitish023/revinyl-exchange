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
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    for (const price of ['38.00', '40.00', '42.00']) await sale(seller, buyer, price, VG_PLUS);
    await sale(seller, buyer, '55.00', NM);
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
