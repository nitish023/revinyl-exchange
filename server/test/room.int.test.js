/**
 * Part 6: the Listening Room, read from the demo market (src/db/seed.js). For release
 * 249504 the demo prices work out to: asks NM $24 (secondspin), VG+ $20 (harbormaster),
 * VG+ $21 (paperlantern), VG $12 (latenight), G+ $7 (groovegarden); wanted ads NM $22
 * (latenight), VG+ $17 (secondspin), VG $10 (harbormaster).
 */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { DEMO_PASSWORD, DEMO_TRADERS, FIXTURE_RELEASE_ID, seedDemo } from '../src/db/seed.js';
import { createTestContext, resetDatabase } from './helpers.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
  await seedDemo(ctx.pool);
});
afterAll(() => ctx.pool.end());

async function roomOf(name) {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: `${name}@example.com`, password: DEMO_PASSWORD })
    .expect(200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const { body } = await request(app).get('/api/room').set('Cookie', cookie).expect(200);
  return body.room;
}

const idOf = async (name) =>
  (await ctx.pool.query('SELECT id FROM users WHERE display_name = $1', [name])).rows[0].id;

it('needs a login', async () => {
  await request(app).get('/api/room').expect(401);
});

describe('the shelf', () => {
  it('shows my copies newest first, with an open ad’s price', async () => {
    const room = await roomOf('groovegarden');
    const copies = room.shelf.filter((item) => item.kind === 'copy');
    expect(copies.map((copy) => [copy.condition, copy.status, copy.ask?.price ?? null])).toEqual([
      ['G+/G+', 'listed', '7.00'],
      ['VG/VG', 'in_crate', null],
    ]);
    expect(copies[0].release).toMatchObject({
      id: FIXTURE_RELEASE_ID,
      title: 'Never Gonna Give You Up',
    });
  });

  it('shows a record I bought as on its way, and the seller’s copy as sold', async () => {
    const buyer = await idOf('groovegarden');
    // Buys harbormaster's $20 VG+ copy.
    await ctx.orders.place(
      { id: buyer },
      { side: 'bid', releaseId: FIXTURE_RELEASE_ID, price: '20', minGrade: 6 },
    );

    const mine = await roomOf('groovegarden');
    expect(mine.shelf[0]).toMatchObject({
      kind: 'incoming',
      condition: 'VG+/VG+',
      tradeStatus: 'awaiting_shipment',
      price: '20.00',
    });

    const theirs = await roomOf('harbormaster');
    const sold = theirs.shelf.find((item) => item.kind === 'copy' && item.status === 'in_trade');
    expect(sold).toMatchObject({ tradeStatus: 'awaiting_shipment', ask: null });
  });
});

describe('wanted ads', () => {
  it('say what the cheapest good-enough copy costs and how many others are waiting', async () => {
    const room = await roomOf('secondspin');
    expect(room.wanted).toEqual([
      expect.objectContaining({ price: '17.00', minGrade: 6, cheapest: '20.00', otherBuyers: 2 }),
    ]);
    // secondspin's own NM ask doesn't count as a copy for their own wanted ad.
  });

  it('say so when nothing good enough is for sale', async () => {
    const room = await roomOf('latenight'); // wants NM; the only NM copy is $24 from someone else
    expect(room.wanted[0]).toMatchObject({ minGrade: 7, cheapest: '24.00' });
    await ctx.pool.query(
      `UPDATE orders SET status = 'cancelled', closed_at = now()
        WHERE side = 'ask' AND status = 'open' AND price_cents = 2400`,
    );
    expect((await roomOf('latenight')).wanted[0].cheapest).toBeNull();
  });
});

describe('the ledger', () => {
  it('lists every trade I was in, newest first, with my side', async () => {
    const room = await roomOf('groovegarden');
    expect(room.ledger.map((trade) => [trade.role, trade.price, trade.status])).toEqual([
      ['seller', '19.00', 'completed'],
      ['buyer', '10.00', 'completed'],
      ['seller', '17.00', 'completed'],
    ]);
  });
});

describe('the counter and the shelf’s value', () => {
  it('finds the best wanted ad one of my copies can fill', async () => {
    const room = await roomOf('groovegarden');
    expect(room.counter).toMatchObject({ price: '10.00', minGrade: 5, myGrade: 5 });
    expect(room.value).toEqual({ total: '10.00', copies: 1 });
  });

  it('is empty when nobody wants what I have', async () => {
    await ctx.pool.query(
      `UPDATE orders SET status = 'cancelled', closed_at = now() WHERE side = 'bid' AND status = 'open'`,
    );
    await ctx.pool.query('UPDATE users SET held_cents = 0');
    const room = await roomOf('groovegarden');
    expect(room.counter).toBeNull();
    expect(room.value).toBeNull();
  });
});

it('shows my wallet, and never another trader’s name or email', async () => {
  const room = await roomOf('groovegarden');
  expect(room.user.displayName).toBe('groovegarden');
  expect(Number(room.wallet.cash) - Number(room.wallet.held)).toBe(Number(room.wallet.spendable));
  const text = JSON.stringify(room);
  expect(text).not.toContain('@example.com');
  for (const other of DEMO_TRADERS.filter((name) => name !== 'groovegarden')) {
    expect(text).not.toContain(other);
  }
});
