/**
 * Part 3: crates, wallets, placing and cancelling orders, against the real database.
 * Each test starts from an empty database and an empty set of order books.
 */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PHOTO_BYTES, STARTING_CASH_CENTS } from '../../shared/index.js';
import { createApp } from '../src/app.js';
import { FIXTURE_RELEASE_ID, seedDemo } from '../src/db/seed.js';
import { createTestContext, resetDatabase } from './helpers.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const RELEASE = FIXTURE_RELEASE_ID;
const VG = 5;
const VG_PLUS = 6;
const NM = 7;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
  ctx.live.markets.length = 0;
  ctx.live.messages.length = 0;
});
afterAll(() => ctx.pool.end());

const query = async (sql, params) => (await ctx.pool.query(sql, params)).rows;

/** Sign up a trader and return small helpers that send requests as them. */
async function signUp(name) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email: `${name}@example.com`, displayName: name, password: 'password123' })
    .expect(201);
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  return {
    id: response.body.user.id,
    get: (path) => request(app).get(path).set('Cookie', cookie),
    post: (path, body) => request(app).post(path).set('Cookie', cookie).send(body),
    del: (path) => request(app).delete(path).set('Cookie', cookie),
    upload: (path, bytes, type) =>
      request(app).post(path).set('Cookie', cookie).set('Content-Type', type).send(bytes),
  };
}

async function addCopy(user, overrides = {}) {
  const response = await user
    .post('/api/crate', { releaseId: RELEASE, grade: VG_PLUS, sleeveGrade: VG_PLUS, ...overrides })
    .expect(201);
  return response.body.copy;
}

/** List a new copy of the given grade for sale; returns the ask and the copy. */
async function listCopy(user, price, grade = VG_PLUS) {
  const copy = await addCopy(user, { grade });
  const response = await user
    .post('/api/orders', { side: 'ask', copyId: copy.id, price })
    .expect(201);
  return { copy, ...response.body };
}

function placeBid(user, price, minGrade = VG_PLUS, extra = {}) {
  return user.post('/api/orders', { side: 'bid', releaseId: RELEASE, price, minGrade, ...extra });
}

async function walletOf(user) {
  return (await user.get('/api/wallet').expect(200)).body.wallet;
}

async function copyStatus(copyId) {
  return (await query('SELECT status FROM copies WHERE id = $1', [copyId]))[0].status;
}

describe('wallet', () => {
  it('a new account starts with $2,000 and nothing held', async () => {
    const alice = await signUp('alice');

    expect(STARTING_CASH_CENTS).toBe(200_000);
    expect(await walletOf(alice)).toEqual({
      cash: '2000.00',
      held: '0.00',
      spendable: '2000.00',
    });
  });

  it('GET /api/wallet needs a login and shows cash, held and spendable', async () => {
    await request(app).get('/api/wallet').expect(401);
    const alice = await signUp('alice');

    await placeBid(alice, '40.50').expect(201);

    expect(await walletOf(alice)).toEqual({
      cash: '2000.00',
      held: '40.50',
      spendable: '1959.50',
    });
  });
});

describe('crate', () => {
  it('adds a copy with grade, sleeve grade (or generic), flags, headline and notes', async () => {
    const alice = await signUp('alice');

    const copy = await addCopy(alice, {
      grade: VG_PLUS,
      sleeveGrade: VG,
      flags: ['seam_split', 'warp', 'warp'],
      headline: '  Played twice.  ',
      notes: 'Quiet all the way through.',
    });
    const generic = await addCopy(alice, { grade: NM, sleeveGrade: null });

    expect(copy).toMatchObject({
      releaseId: RELEASE,
      grade: VG_PLUS,
      sleeveGrade: VG,
      condition: 'VG+/VG',
      flags: ['warp', 'seam_split'],
      headline: 'Played twice.',
      notes: 'Quiet all the way through.',
      status: 'in_crate',
      photos: [],
      ask: null,
    });
    expect(generic.condition).toBe('NM, generic sleeve');
  });

  it('caches the pressing first (ctx.catalog.ensureRelease) and 404s a non-vinyl release', async () => {
    const alice = await signUp('alice');
    expect(await query('SELECT id FROM releases')).toEqual([]);

    await addCopy(alice);
    const missing = await alice
      .post('/api/crate', { releaseId: 999, grade: VG_PLUS, sleeveGrade: null })
      .expect(404);

    expect(await query('SELECT id FROM releases')).toEqual([{ id: RELEASE }]);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(await query('SELECT id FROM copies WHERE release_id = 999')).toEqual([]);
  });

  it('rejects a bad grade, an unknown flag, or notes over 500 characters with field messages', async () => {
    const alice = await signUp('alice');

    const response = await alice
      .post('/api/crate', {
        releaseId: RELEASE,
        grade: 9,
        sleeveGrade: null,
        flags: ['scratched'],
        notes: 'x'.repeat(501),
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(response.body.error.fields).sort()).toEqual(['flags', 'grade', 'notes']);
    expect(await query('SELECT id FROM copies')).toEqual([]);
  });

  it('lists only my own copies', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const first = await addCopy(alice);
    const second = await addCopy(alice, { grade: NM });
    await addCopy(bob);

    const { copies } = (await alice.get('/api/crate').expect(200)).body;
    const forOtherPressing = (await alice.get('/api/crate?releaseId=1').expect(200)).body;

    expect(copies.map((copy) => copy.id)).toEqual([second.id, first.id]);
    expect(copies[0].release).toMatchObject({ id: RELEASE, title: 'Never Gonna Give You Up' });
    expect(forOtherPressing.copies).toEqual([]);
    await request(app).get('/api/crate').expect(401);
  });

  it('removes a copy only while it is in the crate (not listed, not in a trade)', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const inCrate = await addCopy(alice);
    const { copy: sold } = await listCopy(alice, '30');
    await placeBid(bob, '35').expect(201); // buys it
    expect(await copyStatus(sold.id)).toBe('in_trade');
    const { copy: forSale } = await listCopy(alice, '90');

    await alice.del(`/api/crate/${inCrate.id}`).expect(204);
    const listedResponse = await alice.del(`/api/crate/${forSale.id}`).expect(409);
    await alice.del(`/api/crate/${sold.id}`).expect(409);
    await bob.del(`/api/crate/${forSale.id}`).expect(404);

    expect(listedResponse.body.error.code).toBe('COPY_NOT_AVAILABLE');
    const ids = (await alice.get('/api/crate').expect(200)).body.copies.map((copy) => copy.id);
    expect(ids).not.toContain(inCrate.id);
    expect(ids).toContain(forSale.id);
  });

  it('removes a copy that was listed before, keeping its old orders', async () => {
    const alice = await signUp('alice');
    const { copy, order } = await listCopy(alice, '30');
    await alice.del(`/api/orders/${order.id}`).expect(200);

    await alice.del(`/api/crate/${copy.id}`).expect(204);

    expect(await query('SELECT status FROM orders WHERE id = $1', [order.id])).toEqual([
      { status: 'cancelled' },
    ]);
    await alice.post('/api/orders', { side: 'ask', copyId: copy.id, price: '30' }).expect(404);
  });

  it('stores a photo (jpeg, png or webp, up to 2 MB, up to 6 per copy) and serves it back', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const copy = await addCopy(alice);
    const path = `/api/crate/${copy.id}/photos`;

    const first = await alice.upload(path, PNG, 'image/png').expect(201);
    // The claimed type is ignored: the bytes say JPEG, so it is stored as JPEG.
    await alice.upload(path, JPEG, 'image/png').expect(201);
    const served = await request(app).get(first.body.photo.url).expect(200);

    expect(first.body.photo).toEqual({
      position: 1,
      url: `/api/copies/${copy.id}/photos/1`,
    });
    expect(served.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(served.body, PNG)).toBe(0);
    const second = await request(app).get(`/api/copies/${copy.id}/photos/2`).expect(200);
    expect(second.headers['content-type']).toBe('image/jpeg');
    const listed = (await alice.get('/api/crate').expect(200)).body.copies[0];
    expect(listed.photos.map((photo) => photo.position)).toEqual([1, 2]);

    // Not really an image, not an image type, too big, not your copy, not logged in.
    await alice.upload(path, Buffer.from('<script>alert(1)</script>'), 'image/png').expect(415);
    await alice.upload(path, Buffer.from('hello'), 'text/plain').expect(415);
    const huge = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);
    await alice.upload(path, huge, 'image/jpeg').expect(413);
    await bob.upload(path, PNG, 'image/png').expect(404);
    await request(app).post(path).set('Content-Type', 'image/png').send(PNG).expect(401);

    for (let position = 3; position <= 6; position += 1) {
      await alice.upload(path, PNG, 'image/png').expect(201);
    }
    const seventh = await alice.upload(path, PNG, 'image/png').expect(409);
    expect(seventh.body.error.code).toBe('PHOTO_LIMIT');
    await request(app).get(`/api/copies/${copy.id}/photos/7`).expect(400);
    await request(app).get(`/api/copies/999/photos/1`).expect(404);
  });

  it('stops serving the photos of a removed copy', async () => {
    const alice = await signUp('alice');
    const copy = await addCopy(alice);
    await alice.upload(`/api/crate/${copy.id}/photos`, PNG, 'image/png').expect(201);

    await alice.del(`/api/crate/${copy.id}`).expect(204);

    await request(app).get(`/api/copies/${copy.id}/photos/1`).expect(404);
    expect(await query('SELECT id FROM copy_photos')).toEqual([]); // the bytes are freed too
  });

  it('keeps a copy’s photos fixed once it is in a trade', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { copy } = await listCopy(seller, '30');
    await placeBid(buyer, '30').expect(201);

    const response = await seller.upload(`/api/crate/${copy.id}/photos`, PNG, 'image/png');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COPY_NOT_AVAILABLE');
  });
});

describe('placing a wanted ad (bid)', () => {
  it('holds the price and rests when nothing matches', async () => {
    const alice = await signUp('alice');

    const response = await placeBid(alice, '40', VG_PLUS, { note: 'Clean copy, please' }).expect(
      201,
    );

    expect(response.body.trade).toBeNull();
    expect(response.body.order).toMatchObject({
      releaseId: RELEASE,
      side: 'bid',
      price: '40.00',
      minGrade: VG_PLUS,
      note: 'Clean copy, please',
      status: 'open',
      closedAt: null,
    });
    expect((await walletOf(alice)).held).toBe('40.00');
    const book = await ctx.orders.book(RELEASE);
    expect(book.bids().map((order) => order.id)).toEqual([response.body.order.id]);
  });

  it('refuses with INSUFFICIENT_FUNDS when spendable cash is too low, and holds nothing', async () => {
    const alice = await signUp('alice');
    await query('UPDATE users SET cash_cents = 5000 WHERE id = $1', [alice.id]);
    await placeBid(alice, '30').expect(201); // $20 left to spend

    const response = await placeBid(alice, '25').expect(400);

    expect(response.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(response.body.error.fields.price).toMatch(/\$20\.00 to spend/);
    expect(await walletOf(alice)).toMatchObject({ held: '30.00', spendable: '20.00' });
    expect(await query(`SELECT count(*) FROM orders`)).toEqual([{ count: 1 }]);
    expect(ctx.live.markets).toEqual([RELEASE]); // only the first bid was announced
  });

  it('accepts a bid for exactly the cash there is to spend', async () => {
    const alice = await signUp('alice');
    await query('UPDATE users SET cash_cents = 4000 WHERE id = $1', [alice.id]);

    await placeBid(alice, '40').expect(201);

    expect(await walletOf(alice)).toMatchObject({ held: '40.00', spendable: '0.00' });
  });

  it('fills against the cheapest good-enough copy at the ask price, not the bid price', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    await listCopy(seller, '30', VG); // cheapest, but below VG+
    const { order: goodAsk } = await listCopy(seller, '35', VG_PLUS);
    await listCopy(seller, '38', NM);

    const { trade, order } = (await placeBid(buyer, '50', VG_PLUS).expect(201)).body;

    expect(order.status).toBe('filled');
    expect(trade).toMatchObject({ price: '35.00', grade: VG_PLUS, role: 'buyer' });
    const [row] = await query('SELECT ask_order_id FROM trades WHERE id = $1', [trade.id]);
    expect(row.ask_order_id).toBe(goodAsk.id);
  });

  it('creates a trade awaiting shipment, takes the price from the buyer, copy goes in_trade', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { copy, order: ask } = await listCopy(seller, '35');

    const { order: bid } = (await placeBid(buyer, '50').expect(201)).body;

    const [trade] = await query('SELECT * FROM trades');
    expect(trade).toMatchObject({
      release_id: RELEASE,
      copy_id: copy.id,
      grade: VG_PLUS,
      price_cents: 3500,
      bid_order_id: bid.id,
      ask_order_id: ask.id,
      buyer_id: buyer.id,
      seller_id: seller.id,
      status: 'awaiting_shipment',
    });
    expect(await walletOf(buyer)).toEqual({
      cash: '1965.00',
      held: '0.00',
      spendable: '1965.00',
    });
    expect((await walletOf(seller)).cash).toBe('2000.00'); // paid in Part 5
    expect(await copyStatus(copy.id)).toBe('in_trade');
    const orders = await query('SELECT status, closed_at FROM orders ORDER BY id');
    for (const order of orders) {
      expect(order.status).toBe('filled');
      expect(order.closed_at).toBeInstanceOf(Date);
    }
  });

  it('skips my own ask and takes the next one', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    await listCopy(alice, '30');
    const { order: bobsAsk } = await listCopy(bob, '35');

    const { trade } = (await placeBid(alice, '50').expect(201)).body;

    expect(trade.price).toBe('35.00');
    const [row] = await query('SELECT ask_order_id, seller_id FROM trades');
    expect(row).toEqual({ ask_order_id: bobsAsk.id, seller_id: bob.id });
  });

  it('announces the market change and tells buyer and seller after the commit', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { order: ask } = await listCopy(seller, '35');
    ctx.live.markets.length = 0;
    ctx.live.messages.length = 0;
    // When the market is announced, the book must already show the sale (it's applied
    // only after COMMIT), so the page never redraws from a book that's ahead of the database.
    let asksWhenAnnounced = null;
    const recordMarket = ctx.live.marketChanged.bind(ctx.live);
    ctx.live.marketChanged = (releaseId) => {
      asksWhenAnnounced = ctx.orders.books.get(releaseId).asks().length;
      recordMarket(releaseId);
    };

    try {
      const { order: bid, trade } = (await placeBid(buyer, '50').expect(201)).body;

      expect(ctx.live.markets).toEqual([RELEASE]);
      expect(asksWhenAnnounced).toBe(0);
      expect(ctx.live.messages).toEqual(
        expect.arrayContaining([
          {
            userId: buyer.id,
            message: { type: 'order', releaseId: RELEASE, orderId: bid.id, status: 'filled' },
          },
          {
            userId: seller.id,
            message: { type: 'order', releaseId: RELEASE, orderId: ask.id, status: 'filled' },
          },
          { userId: buyer.id, message: { type: 'trade', releaseId: RELEASE, tradeId: trade.id } },
          { userId: seller.id, message: { type: 'trade', releaseId: RELEASE, tradeId: trade.id } },
          { userId: buyer.id, message: { type: 'wallet', releaseId: RELEASE } },
        ]),
      );
      const recipients = new Set(ctx.live.messages.map((entry) => entry.userId));
      expect([...recipients].sort()).toEqual([seller.id, buyer.id].sort());
    } finally {
      delete ctx.live.marketChanged;
    }
  });

  it('checks the body: bad prices and grades get field messages', async () => {
    const alice = await signUp('alice');

    const response = await alice
      .post('/api/orders', { side: 'bid', releaseId: RELEASE, price: '40.505', minGrade: 0 })
      .expect(400);
    const noLogin = await request(app)
      .post('/api/orders')
      .send({ side: 'bid', releaseId: RELEASE, price: '40', minGrade: VG_PLUS });

    expect(Object.keys(response.body.error.fields).sort()).toEqual(['minGrade', 'price']);
    expect(noLogin.status).toBe(401);
    await placeBid(alice, '40', VG_PLUS, { releaseId: 999 }).expect(404);
  });
});

describe('placing a FOR SALE ad (ask)', () => {
  it('lists a copy from my crate and rests when nothing matches', async () => {
    const alice = await signUp('alice');
    const copy = await addCopy(alice);

    const response = await alice
      .post('/api/orders', { side: 'ask', copyId: copy.id, price: '42.00' })
      .expect(201);

    expect(response.body.trade).toBeNull();
    expect(response.body.order).toMatchObject({
      side: 'ask',
      copyId: copy.id,
      price: '42.00',
      status: 'open',
    });
    expect(await copyStatus(copy.id)).toBe('listed');
    const crate = (await alice.get('/api/crate').expect(200)).body.copies;
    expect(crate[0].ask).toEqual({ orderId: response.body.order.id, price: '42.00' });
  });

  it('refuses a copy that is not mine, or not in my crate (404 / 409)', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const { copy: listed } = await listCopy(alice, '42');

    const notMine = await bob
      .post('/api/orders', { side: 'ask', copyId: listed.id, price: '10' })
      .expect(404);
    const twice = await alice
      .post('/api/orders', { side: 'ask', copyId: listed.id, price: '10' })
      .expect(409);

    expect(notMine.body.error.code).toBe('NOT_FOUND');
    expect(twice.body.error.code).toBe('COPY_NOT_AVAILABLE');
    expect(await query(`SELECT count(*) FROM orders`)).toEqual([{ count: 1 }]);
  });

  it('fills against the highest bid it qualifies for, at the bid price', async () => {
    const seller = await signUp('seller');
    const buyers = [await signUp('buyer1'), await signUp('buyer2'), await signUp('buyer3')];
    const { order: best } = (await placeBid(buyers[0], '40', VG_PLUS).expect(201)).body;
    await placeBid(buyers[1], '45', NM).expect(201); // higher, but wants better than VG+
    await placeBid(buyers[2], '30', VG).expect(201);

    const { trade, order } = await listCopy(seller, '25', VG_PLUS);

    expect(order.status).toBe('filled');
    expect(trade).toMatchObject({ price: '40.00', role: 'seller' });
    const [row] = await query('SELECT bid_order_id FROM trades');
    expect(row.bid_order_id).toBe(best.id);
  });

  it('releases the buyer’s hold and takes the trade price from their cash', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    await placeBid(buyer, '40').expect(201);
    expect((await walletOf(buyer)).held).toBe('40.00');

    const { copy } = await listCopy(seller, '25');

    expect(await walletOf(buyer)).toEqual({
      cash: '1960.00',
      held: '0.00',
      spendable: '1960.00',
    });
    expect((await walletOf(seller)).cash).toBe('2000.00');
    expect(await copyStatus(copy.id)).toBe('in_trade');
  });
});

describe('cancelling', () => {
  it('cancels my open bid and gives the held cash back', async () => {
    const alice = await signUp('alice');
    const { order } = (await placeBid(alice, '40').expect(201)).body;

    const response = await alice.del(`/api/orders/${order.id}`).expect(200);

    expect(response.body.order).toMatchObject({ id: order.id, status: 'cancelled' });
    expect(response.body.order.closedAt).not.toBeNull();
    expect(await walletOf(alice)).toMatchObject({ held: '0.00', spendable: '2000.00' });
  });

  it('cancels my open ask and puts the copy back in the crate', async () => {
    const alice = await signUp('alice');
    const { copy, order } = await listCopy(alice, '42');

    await alice.del(`/api/orders/${order.id}`).expect(200);

    expect(await copyStatus(copy.id)).toBe('in_crate');
    // Back in the crate means it can be listed again.
    await alice.post('/api/orders', { side: 'ask', copyId: copy.id, price: '40' }).expect(201);
  });

  it('refuses someone else’s order (404) and a filled or cancelled one (409)', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const { order: open } = (await placeBid(alice, '40').expect(201)).body;
    const { order: filledAsk } = await listCopy(bob, '30');
    const { order: cancelled } = (await placeBid(alice, '20').expect(201)).body;
    await alice.del(`/api/orders/${cancelled.id}`).expect(200);
    // The $40 bid takes bob's $30 copy, filling both orders.
    expect((await query(`SELECT status FROM orders WHERE id = $1`, [open.id]))[0].status).toBe(
      'filled',
    );

    await bob.del(`/api/orders/${open.id}`).expect(404);
    await alice.del('/api/orders/999999').expect(404);
    const filled = await bob.del(`/api/orders/${filledAsk.id}`).expect(409);
    const again = await alice.del(`/api/orders/${cancelled.id}`).expect(409);

    expect(filled.body.error.code).toBe('ORDER_NOT_OPEN');
    expect(again.body.error.code).toBe('ORDER_NOT_OPEN');
    expect((await walletOf(alice)).held).toBe('0.00'); // nothing given back twice
  });

  it('removes the order from the book so it can no longer match', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { order } = await listCopy(seller, '30');

    await seller.del(`/api/orders/${order.id}`).expect(200);
    const { trade } = (await placeBid(buyer, '50').expect(201)).body;

    expect(trade).toBeNull();
    const book = await ctx.orders.book(RELEASE);
    expect(book.asks()).toEqual([]);
  });
});

describe('listing my orders', () => {
  it('shows only my orders, newest first, filtered by status and pressing', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const { order: first } = (await placeBid(alice, '10').expect(201)).body;
    const { order: second } = await listCopy(alice, '90');
    await alice.del(`/api/orders/${first.id}`).expect(200);
    await placeBid(bob, '20').expect(201);

    const all = (await alice.get('/api/orders').expect(200)).body.orders;
    const open = (await alice.get('/api/orders?status=open').expect(200)).body.orders;
    const cancelled = (await alice.get('/api/orders?status=cancelled').expect(200)).body.orders;
    const otherPressing = (await alice.get('/api/orders?releaseId=1').expect(200)).body.orders;

    expect(all.map((order) => order.id)).toEqual([second.id, first.id]);
    expect(all[0]).toMatchObject({
      side: 'ask',
      price: '90.00',
      release: { id: RELEASE, title: 'Never Gonna Give You Up' },
      copy: { grade: VG_PLUS, sleeveGrade: VG_PLUS },
    });
    expect(open.map((order) => order.id)).toEqual([second.id]);
    expect(cancelled.map((order) => order.id)).toEqual([first.id]);
    expect(otherPressing).toEqual([]);
    await alice.get('/api/orders?status=lost').expect(400);
    await request(app).get('/api/orders').expect(401);
  });
});

describe('keeping the book and the database in step', () => {
  it('two bids for the same last copy at the same moment: exactly one trade', async () => {
    const seller = await signUp('seller');
    const first = await signUp('first');
    const second = await signUp('second');
    const { copy } = await listCopy(seller, '30');
    // Slow down writing the trade, so the second bid surely arrives while the first is
    // still in its transaction. Only the per-pressing queue keeps it from matching the
    // same copy from a book that hasn't caught up yet.
    const slowTrades = hookQueries((sql) => (sql.includes('INSERT INTO trades') ? 100 : null));

    let responses;
    try {
      responses = await Promise.all([placeBid(first, '40'), placeBid(second, '40')]);
    } finally {
      slowTrades.mockRestore();
    }

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const trades = await query('SELECT buyer_id FROM trades');
    expect(trades).toHaveLength(1);
    const winner = trades[0].buyer_id === first.id ? first : second;
    const loser = winner === first ? second : first;
    expect(await copyStatus(copy.id)).toBe('in_trade');
    expect(await walletOf(winner)).toMatchObject({ cash: '1970.00', held: '0.00' });
    expect(await walletOf(loser)).toMatchObject({ cash: '2000.00', held: '40.00' });
  });

  it('a failed transaction leaves the book unchanged (match, then save, then apply)', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { copy, order: ask } = await listCopy(seller, '30');
    const failTradeInserts = hookQueries((sql) =>
      sql.includes('INSERT INTO trades') ? 'fail' : null,
    );
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const failed = await placeBid(buyer, '40').expect(500);
      expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      failTradeInserts.mockRestore();
      quiet.mockRestore();
    }

    const book = await ctx.orders.book(RELEASE);
    expect(book.asks().map((order) => order.id)).toEqual([ask.id]);
    expect(book.bids()).toEqual([]);
    expect(await query('SELECT id FROM orders WHERE side = $1', ['bid'])).toEqual([]);
    expect(await copyStatus(copy.id)).toBe('listed');
    expect(await walletOf(buyer)).toMatchObject({ cash: '2000.00', held: '0.00' });
    expect(ctx.live.markets).toEqual([RELEASE]); // the listing, not the failed bid
    // The same bid works once the database does.
    expect((await placeBid(buyer, '40').expect(201)).body.trade.price).toBe('30.00');
  });

  it('the book loads open orders from the database the first time a pressing is used', async () => {
    await seedDemo(ctx.pool);
    const buyer = await signUp('buyer');
    expect(ctx.orders.books.size).toBe(0);

    const book = await ctx.orders.book(RELEASE);
    const [{ asks, bids }] = await query(
      `SELECT count(*) FILTER (WHERE side = 'ask') AS asks, count(*) FILTER (WHERE side = 'bid') AS bids
         FROM orders WHERE release_id = $1 AND status = 'open'`,
      [RELEASE],
    );
    expect(book.asks()).toHaveLength(asks);
    expect(book.bids()).toHaveLength(bids);

    // A bid that beats every seeded VG+ ask fills against the cheapest one it loaded.
    const cheapest = book.asks().find((order) => order.grade >= VG_PLUS);
    const { trade } = (await placeBid(buyer, '100').expect(201)).body;
    expect(trade.price).toBe((cheapest.priceCents / 100).toFixed(2));
  });

  it('drops a book that disagrees with the database, and the next order reloads it', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { copy, order: ask } = await listCopy(seller, '30');
    // Something outside this server cancels the ask, so the cached book is now wrong.
    await query(`UPDATE orders SET status = 'cancelled', closed_at = now() WHERE id = $1`, [
      ask.id,
    ]);
    await query(`UPDATE copies SET status = 'in_crate' WHERE id = $1`, [copy.id]);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await placeBid(buyer, '40').expect(500); // matched the stale ask; rolled back
    } finally {
      quiet.mockRestore();
    }
    const { trade, order } = (await placeBid(buyer, '40').expect(201)).body;

    expect(trade).toBeNull(); // the reloaded book knows the ask is gone
    expect(order.status).toBe('open');
    expect(await query('SELECT id FROM trades')).toEqual([]);
    expect(await walletOf(buyer)).toMatchObject({ cash: '2000.00', held: '40.00' });
  });

  it('never creates or loses money: cash plus money in trades stays the same', async () => {
    const traders = [await signUp('anna'), await signUp('ben'), await signUp('cara')];
    const [a, b, c] = traders;
    await listCopy(a, '30');
    await listCopy(b, '45', NM);
    await placeBid(c, '50', VG_PLUS).expect(201); // buys a's copy
    await placeBid(a, '60', NM).expect(201); // buys b's copy
    const { order } = (await placeBid(b, '20', VG).expect(201)).body;
    await b.del(`/api/orders/${order.id}`).expect(200);
    await placeBid(c, '10', VG).expect(201); // rests

    const [{ cash }] = await query('SELECT sum(cash_cents)::bigint AS cash FROM users');
    const [{ inTrades }] = await query(
      `SELECT coalesce(sum(price_cents), 0)::bigint AS "inTrades" FROM trades`,
    );
    expect(cash + inTrades).toBe(traders.length * STARTING_CASH_CENTS);
    const holds = await query(`
      SELECT u.held_cents,
             coalesce((SELECT sum(price_cents)::bigint FROM orders o
                        WHERE o.user_id = u.id AND o.side = 'bid' AND o.status = 'open'), 0) AS open
        FROM users u`);
    for (const row of holds) expect(row.held_cents).toBe(row.open);
  });
});

/**
 * Make some database queries inside transactions fail or run slowly, to test what a
 * failure leaves behind and what happens when two requests overlap.
 * `decide(sql)` returns 'fail', a delay in milliseconds, or null to run the query normally.
 * Returns the spy; call mockRestore() to stop.
 * @param {(sql: string) => 'fail' | number | null} decide
 */
function hookQueries(decide) {
  const connect = ctx.pool.connect.bind(ctx.pool);
  return vi.spyOn(ctx.pool, 'connect').mockImplementation(async (...args) => {
    // pool.query() calls connect(callback) internally; leave that path alone.
    if (args.length > 0) return connect(...args);
    const client = await connect();
    const realQuery = client.query;
    const realRelease = client.release;
    client.query = async function (sql, ...rest) {
      const action = typeof sql === 'string' ? decide(sql) : null;
      if (action === 'fail') throw new Error('simulated database failure');
      if (typeof action === 'number') await new Promise((resolve) => setTimeout(resolve, action));
      return realQuery.call(this, sql, ...rest);
    };
    client.release = function (...args) {
      client.query = realQuery; // the client goes back to the pool working normally
      client.release = realRelease;
      return realRelease.apply(this, args);
    };
    return client;
  });
}
