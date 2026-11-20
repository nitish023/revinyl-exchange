/**
 * Part 15: ads that expire, and "stay on top" repricing rules, against the real database.
 * Every test ends with the exchange's rules and the books checked (expectExchangeConsistent).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestContext, expectExchangeConsistent, resetDatabase } from './helpers.js';
import { NM, RELEASE, traders, VG_PLUS } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { query, signUp, addCopy, placeBid, walletOf, setCash } = traders(ctx, app);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
  ctx.live.messages.length = 0;
});
afterEach(() => expectExchangeConsistent(ctx));
afterAll(() => ctx.pool.end());

const DAY = 86_400_000;
const orderRow = async (id) => (await query('SELECT * FROM orders WHERE id = $1', [id]))[0];

/** List a new copy with optional Part 15 settings; returns the response body. */
async function list(user, price, extra = {}, grade = VG_PLUS) {
  const copy = await addCopy(user, { grade });
  return (
    await user.post('/api/orders', { side: 'ask', copyId: copy.id, price, ...extra }).expect(201)
  ).body;
}

/** Pretend an open order was placed two days ago and ran out yesterday. */
async function runOut(orderId) {
  await query(
    `UPDATE orders SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
      WHERE id = $1`,
    [orderId],
  );
}

describe('ads that expire', () => {
  it('a WANTED ad runs 30 days unless told otherwise; a FOR SALE ad until it’s cancelled', async () => {
    const ana = await signUp('anna');
    const { order: wanted } = (await placeBid(ana, '20.00').expect(201)).body;
    const days = (Date.parse(wanted.expiresAt) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    const { order: forSale } = await list(ana, '50.00');
    expect(forSale.expiresAt).toBeNull();
    const { order: forever } = (
      await placeBid(ana, '10.00', VG_PLUS, { expiresInDays: null }).expect(201)
    ).body;
    expect(forever.expiresAt).toBeNull();
    const { order: week } = await list(ana, '60.00', { expiresInDays: 7 });
    expect((Date.parse(week.expiresAt) - Date.now()) / DAY).toBeCloseTo(7, 1);
  });

  it('refuses a length that isn’t one of the choices', async () => {
    const ana = await signUp('anna');
    const response = await placeBid(ana, '20.00', VG_PLUS, { expiresInDays: 12 }).expect(400);
    expect(response.body.error.fields.expiresInDays).toBe('Pick how long the ad runs');
  });

  it('an expired WANTED ad never fills: the next order on the pressing closes it first', async () => {
    const [ana, ben] = await Promise.all(['anna', 'benny'].map((name) => signUp(name)));
    const { order: wanted } = (await placeBid(ana, '40.00').expect(201)).body;
    await runOut(wanted.id);
    const { order: forSale, trade } = await list(ben, '35.00');
    expect(trade).toBeNull();
    expect(forSale.status).toBe('open');
    expect(await orderRow(wanted.id)).toMatchObject({ status: 'expired' });
    expect(await walletOf(ana)).toMatchObject({ held: '0.00', cash: '2000.00' });
    expect(ctx.live.messages).toContainEqual({
      userId: ana.id,
      message: { type: 'order', releaseId: RELEASE, orderId: wanted.id, status: 'expired' },
    });
  });

  it('the sweep expires ads on a quiet pressing, giving the copy back to the crate', async () => {
    const ana = await signUp('anna');
    const { order, copy } = await list(ana, '50.00', { expiresInDays: 7 });
    expect(await ctx.orders.sweepExpired()).toBe(0);
    await runOut(order.id);
    expect(await ctx.orders.sweepExpired()).toBe(1);
    expect(await orderRow(order.id)).toMatchObject({ status: 'expired' });
    const [{ status }] = await query('SELECT status FROM copies WHERE id = $1', [
      copy?.id ?? order.copyId,
    ]);
    expect(status).toBe('in_crate');
    expect(await ctx.orders.sweepExpired()).toBe(0);
  });

  it('an expired ad can’t be cancelled: it says so', async () => {
    const ana = await signUp('anna');
    const { order } = (await placeBid(ana, '40.00').expect(201)).body;
    await runOut(order.id);
    await ctx.orders.sweepExpired();
    const response = await ana.del(`/api/orders/${order.id}`).expect(409);
    expect(response.body.error.message).toMatch(/has expired/);
  });
});

describe('“stay on top” repricing', () => {
  it('a FOR SALE ad follows a cheaper rival down a step at a time, but not below its floor', async () => {
    const [ana, ben] = await Promise.all(['anna', 'benny'].map((name) => signUp(name)));
    const { order: mine } = await list(ana, '50.00', {
      repriceStep: '1.00',
      repriceLimit: '30.00',
    });
    expect(mine.reprice).toEqual({ step: '1.00', limit: '30.00' });

    await list(ben, '45.00');
    const open = async () =>
      query(
        `SELECT id, price_cents, replaces_order_id FROM orders
          WHERE user_id = $1 AND status = 'open'`,
        [ana.id],
      );
    let [now] = await open();
    expect(now).toMatchObject({ price_cents: 4400, replaces_order_id: mine.id });
    expect(await orderRow(mine.id)).toMatchObject({ status: 'cancelled' });

    await list(ben, '20.00');
    [now] = await open();
    expect(now.price_cents).toBe(3000); // the floor
    // A rival of another grade doesn't count.
    await list(ben, '10.00', {}, NM);
    expect((await open())[0].price_cents).toBe(3000);
  });

  it('a lowered FOR SALE ad that meets a WANTED ad sells, at the WANTED ad’s price', async () => {
    const [ana, ben, cy] = await Promise.all(
      ['anna', 'benny', 'cyrus'].map((name) => signUp(name)),
    );
    await placeBid(cy, '35.00').expect(201);
    await list(ana, '50.00', { repriceStep: '1.00', repriceLimit: '30.00' });
    await list(ben, '36.00'); // rests above the $35 offer; Ana's rule drops to $35 and sells
    const [trade] = await query('SELECT * FROM trades');
    expect(trade).toMatchObject({ seller_id: ana.id, buyer_id: cy.id, price_cents: 3500 });
  });

  it('a WANTED ad rises over a higher offer up to its ceiling, holding the extra cash', async () => {
    const [ana, ben] = await Promise.all(['anna', 'benny'].map((name) => signUp(name)));
    await placeBid(ana, '20.00', VG_PLUS, { repriceStep: '1.00', repriceLimit: '40.00' }).expect(
      201,
    );
    await placeBid(ben, '25.00').expect(201);
    expect(await walletOf(ana)).toMatchObject({ held: '26.00' });
    await placeBid(ben, '45.00').expect(201);
    expect(await walletOf(ana)).toMatchObject({ held: '40.00' }); // the ceiling
  });

  it('a WANTED ad that can’t afford to rise stays where it is', async () => {
    const [ana, ben] = await Promise.all(['anna', 'benny'].map((name) => signUp(name)));
    await setCash(ana, 2500);
    await placeBid(ana, '20.00', VG_PLUS, { repriceStep: '1.00', repriceLimit: '40.00' }).expect(
      201,
    );
    await placeBid(ben, '30.00').expect(201); // Ana would need $31 held, and has $25
    expect(await walletOf(ana)).toMatchObject({ held: '20.00' });
  });

  it('two sellers’ rules in a price war stop at their floors', async () => {
    const [ana, ben, cy] = await Promise.all(
      ['anna', 'benny', 'cyrus'].map((name) => signUp(name)),
    );
    await list(ana, '50.00', { repriceStep: '2.00', repriceLimit: '30.00' });
    await list(ben, '50.00', { repriceStep: '2.00', repriceLimit: '34.00' });
    await list(cy, '45.00');
    const prices = await query(
      `SELECT user_id, price_cents FROM orders WHERE status = 'open' ORDER BY price_cents`,
    );
    // Each undercuts the other by $2 until Ben can't go below $34; Ana then sits at $32.
    expect(prices).toEqual([
      { user_id: ana.id, price_cents: 3200 },
      { user_id: ben.id, price_cents: 3400 },
      { user_id: cy.id, price_cents: 4500 },
    ]);
  });

  it('refuses a floor above the asking price, or a step without a limit', async () => {
    const ana = await signUp('anna');
    const copy = await addCopy(ana);
    const bad = await ana
      .post('/api/orders', {
        side: 'ask',
        copyId: copy.id,
        price: '40',
        repriceStep: '1',
        repriceLimit: '45',
      })
      .expect(400);
    expect(bad.body.error.fields.repriceLimit).toMatch(/can’t be above your asking price/);
    const half = await ana
      .post('/api/orders', { side: 'ask', copyId: copy.id, price: '40', repriceStep: '1' })
      .expect(400);
    expect(half.body.error.fields.repriceLimit).toMatch(/both the step and the limit/);
  });
});
