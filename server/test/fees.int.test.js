/**
 * Part 12: seller fees, levels and reliability against the real database. The fee is fixed
 * on the trade when it's made, at the seller's level then, and taken out of the payout.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestContext, expectExchangeConsistent, resetDatabase } from './helpers.js';
import { traders } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { query, signUp, listCopy, walletOf } = traders(ctx, app);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
});
afterEach(() => expectExchangeConsistent(ctx));
afterAll(() => ctx.pool.end());

const buy = (user, orderId) => user.post(`/api/orders/${orderId}/buy`, {});
const step = (user, tradeId, name) => user.post(`/api/trades/${tradeId}/${name}`, {});
const standingOf = async (user) => (await user.get('/api/seller').expect(200)).body.standing;
const feeOf = async (tradeId) =>
  (await query('SELECT seller_fee_cents FROM trades WHERE id = $1', [tradeId]))[0].seller_fee_cents;

/** A sale from seller to buyer, taken as far as `until`: made, refunded or completed. */
async function sell(seller, buyer, price, until = 'completed') {
  const { order } = await listCopy(seller, price);
  const { trade } = (await buy(buyer, order.id).expect(201)).body;
  if (until === 'completed') {
    await step(seller, trade.id, 'ship').expect(200);
    await step(buyer, trade.id, 'received').expect(200);
  } else if (until === 'refunded') {
    await step(seller, trade.id, 'cancel').expect(200);
  }
  return trade;
}

describe('seller fees', () => {
  it('a new seller pays 12% (9% + 3% processing), taken from the payout', async () => {
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    const trade = await sell(seller, buyer, '40.00');
    expect(await feeOf(trade.id)).toBe(480);
    expect(await walletOf(seller)).toMatchObject({ cash: '2035.20' });
    expect(await walletOf(buyer)).toMatchObject({ cash: '1960.00' }); // the buyer pays the price
    expect((await request(app).get('/api/books').expect(200)).body.books.fees).toBe('4.80');
  });

  it('three completed sales worth $100 make level 2: the next sale costs 11.5%', async () => {
    const seller = await signUp('sella');
    const buyers = [await signUp('buyer'), await signUp('buyer2'), await signUp('buyer3')];
    const buyer = buyers[0];
    for (const each of buyers) await sell(seller, each, '40.00');
    expect(await standingOf(seller)).toMatchObject({
      level: 2,
      fee: '11.5%',
      sales90: 3,
      volume90: '120.00',
      next: { level: 3, salesNeeded: 7, volumeNeeded: '380.00', fee: '11%' },
    });
    const fourth = await sell(seller, buyer, '40.00', 'made');
    expect(await feeOf(fourth.id)).toBe(460); // 8.5% + 3% of $40
  });

  it('fixes the fee when the sale is made, even if the seller levels up before payout', async () => {
    const seller = await signUp('sella');
    const buyers = [await signUp('buyer'), await signUp('buyer2'), await signUp('buyer3')];
    const buyer = buyers[0];
    const early = await sell(seller, buyer, '40.00', 'made'); // made at level 1
    for (const each of buyers) await sell(seller, each, '40.00');
    expect((await standingOf(seller)).level).toBe(2);
    await step(seller, early.id, 'ship').expect(200);
    await step(buyer, early.id, 'received').expect(200);
    expect(await feeOf(early.id)).toBe(480); // still the level 1 fee
  });

  it('selling to the same buyer over and over can’t buy a level (Part 17)', async () => {
    const [seller, friend] = [await signUp('sella'), await signUp('buyer')];
    for (let i = 0; i < 5; i += 1) await sell(seller, friend, '40.00');
    // Only two sales to one buyer count, so $80 in two sales: still level 1.
    expect(await standingOf(seller)).toMatchObject({ level: 1, sales90: 2, completed: 5 });
  });

  it('a copy sold and bought back doesn’t count either', async () => {
    const [seller, friend, other] = [
      await signUp('sella'),
      await signUp('buyer'),
      await signUp('other'),
    ];
    const { copy, order } = await listCopy(seller, '60.00');
    const { trade } = (await buy(friend, order.id).expect(201)).body;
    await step(seller, trade.id, 'ship').expect(200);
    await step(friend, trade.id, 'received').expect(200);
    const back = (await friend.post('/api/orders', { side: 'ask', copyId: copy.id, price: '60' }))
      .body.order;
    const { trade: returned } = (await buy(seller, back.id).expect(201)).body;
    await step(friend, returned.id, 'ship').expect(200);
    await step(seller, returned.id, 'received').expect(200);
    await sell(seller, other, '40.00');
    expect(await standingOf(seller)).toMatchObject({ sales90: 1, volume90: '40.00', completed: 2 });
  });

  it('only counts the last 90 days', async () => {
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    for (let i = 0; i < 3; i += 1) await sell(seller, buyer, '40.00');
    await query(`UPDATE trades SET settled_at = now() - interval '91 days'`);
    expect(await standingOf(seller)).toMatchObject({ level: 1, sales90: 0, completed: 3 });
  });

  it('a refunded sale costs the seller nothing', async () => {
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    await sell(seller, buyer, '40.00', 'refunded');
    expect(await walletOf(seller)).toMatchObject({ cash: '2000.00' });
    expect((await request(app).get('/api/books').expect(200)).body.books.fees).toBe('0.00');
  });
});

describe('reliability', () => {
  it('drops with refunds, and a seller can’t reach the top levels without it', async () => {
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    await sell(seller, buyer, '40.00');
    await sell(seller, buyer, '40.00', 'refunded');
    await sell(seller, buyer, '40.00', 'refunded');
    const standing = await standingOf(seller);
    expect(standing).toMatchObject({ completed: 1, refunded: 2 });
    expect(standing.reliability).toBeLessThan(0.33);
  });

  it('signs ads "New seller" until three settled sales, then with the score', async () => {
    const [seller, buyer] = [await signUp('sella'), await signUp('buyer')];
    const market = async () =>
      (await request(app).get('/api/releases/249504/market').expect(200)).body.market;
    await listCopy(seller, '90.00');
    expect((await market()).forSale[0].ads[0].seller.reliability).toBe('New seller');
    for (let i = 0; i < 3; i += 1) await sell(seller, buyer, '40.00');
    const ad = (await market()).forSale[0].ads[0];
    expect(ad.seller).toEqual({ name: 'sella', trades: 3, reliability: '100% of sales completed' });
  });

  it('your standing needs a login', async () => {
    await request(app).get('/api/seller').expect(401);
  });
});
