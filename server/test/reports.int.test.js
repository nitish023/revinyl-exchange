/**
 * Part 18: the reVINYL 30 and portfolios, from the real database.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestContext, expectExchangeConsistent, resetDatabase } from './helpers.js';
import { RELEASE, traders, VG_PLUS } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { query, signUp, addCopy } = traders(ctx, app);
const OTHER = 1234;

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
  ctx.pricing.refresh();
});
afterEach(() => expectExchangeConsistent(ctx));
afterAll(() => ctx.pool.end());

const step = (user, tradeId, name) => user.post(`/api/trades/${tradeId}/${name}`, {});

/** Seller lists a copy (of `releaseId`) and buyer buys it, taken to `until`. */
async function sale(seller, buyer, price, { releaseId = RELEASE, until = 'completed' } = {}) {
  const copy = await addCopy(seller, { releaseId, grade: VG_PLUS });
  const { order } = (
    await seller.post('/api/orders', { side: 'ask', copyId: copy.id, price }).expect(201)
  ).body;
  const { trade } = (await buyer.post(`/api/orders/${order.id}/buy`, {}).expect(201)).body;
  if (until === 'completed') {
    await step(seller, trade.id, 'ship').expect(200);
    await step(buyer, trade.id, 'received').expect(200);
  }
  return { copy, trade };
}

describe('GET /api/index (the reVINYL 30)', () => {
  it('has no level before any sale', async () => {
    const { index } = (await request(app).get('/api/index').expect(200)).body;
    expect(index).toMatchObject({ level: null, series: [], members: [], size: 30 });
  });

  it('starts at 1,000 and weighs pressings by the money traded in them', async () => {
    await query(
      `INSERT INTO releases (id, title, artist, discogs_url) VALUES ($1, 'Other', 'Someone', $2)`,
      [OTHER, `https://www.discogs.com/release/${OTHER}`],
    );
    const people = await Promise.all(['anna', 'benny', 'cyrus', 'delia'].map((n) => signUp(n)));
    await sale(people[0], people[1], '30.00');
    await sale(people[2], people[3], '10.00', { releaseId: OTHER });
    const { index } = (await request(app).get('/api/index').expect(200)).body;
    expect(index.series.at(-1)).toMatchObject({ level: 1000 });
    expect(index.members.map((m) => [m.release.id, Math.round(m.weight * 100)])).toEqual([
      [RELEASE, 75],
      [OTHER, 25],
    ]);
    expect(index.members[0].release.title).toBe('Never Gonna Give You Up');
  });
});

describe('GET /api/portfolio', () => {
  it('marks holdings to fair value, with what each copy cost', async () => {
    const [ana, ben] = [await signUp('anna'), await signUp('benny')];
    await sale(ben, ana, '40.00'); // Ana bought one for $40
    await addCopy(ana); // and has one she added herself
    const { portfolio } = (await ana.get('/api/portfolio').expect(200)).body;
    const byCost = (cost) => portfolio.holdings.find((h) => h.cost === cost);
    expect(byCost('40.00')).toMatchObject({ code: 'VG+', fair: '40.00', unrealized: '0.00' });
    expect(byCost(null)).toMatchObject({ fair: '40.00', unrealized: null });
    expect(portfolio.totals).toMatchObject({
      cash: '1960.00',
      holdings: '80.00',
      netWorth: '2040.00',
      invested: '40.00',
    });
  });

  it('realized gains are the payout after the fee less what that copy cost', async () => {
    const [ana, ben, cy] = await Promise.all(['anna', 'benny', 'cyrus'].map((n) => signUp(n)));
    const { copy } = await sale(ben, ana, '40.00');
    // Ana sells the same copy on to Cy for $60: $52.80 after her 12% fee.
    const { order } = (
      await ana.post('/api/orders', { side: 'ask', copyId: copy.id, price: '60' }).expect(201)
    ).body;
    const { trade } = (await cy.post(`/api/orders/${order.id}/buy`, {}).expect(201)).body;
    await step(ana, trade.id, 'ship').expect(200);
    await step(cy, trade.id, 'received').expect(200);
    const { portfolio } = (await ana.get('/api/portfolio').expect(200)).body;
    expect(portfolio.realized).toEqual([
      expect.objectContaining({ proceeds: '52.80', cost: '40.00', gain: '12.80', heldDays: 0 }),
    ]);
    expect(portfolio.totals).toMatchObject({ realized: '12.80', returnShare: 0.32 });
  });

  it('counts a copy on its way at what it cost, and needs a login', async () => {
    const [ana, ben] = [await signUp('anna'), await signUp('benny')];
    await sale(ben, ana, '25.00', { until: 'made' });
    const { portfolio } = (await ana.get('/api/portfolio').expect(200)).body;
    expect(portfolio.holdings).toEqual([
      expect.objectContaining({ status: 'on_its_way', cost: '25.00', fair: '25.00' }),
    ]);
    await request(app).get('/api/portfolio').expect(401);
  });
});
