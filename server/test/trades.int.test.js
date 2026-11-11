/**
 * Part 5: Buy this copy, Sell to them, and the trade after the match, against the real
 * database. Each test starts from an empty database; ctx.live records what was announced
 * (RecordingLiveUpdates in helpers.js).
 */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestContext, resetDatabase } from './helpers.js';
import { NM, RELEASE, traders, VG, VG_PLUS } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { query, signUp, addCopy, listCopy, placeBid, walletOf, copyStatus, hookQueries } = traders(
  ctx,
  app,
);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
  clearAnnouncements();
});
afterAll(() => ctx.pool.end());

function clearAnnouncements() {
  ctx.live.markets.length = 0;
  ctx.live.messages.length = 0;
}

const buy = (user, orderId, body = {}) => user.post(`/api/orders/${orderId}/buy`, body);
const sellTo = (user, orderId, copyId) => user.post(`/api/orders/${orderId}/sell`, { copyId });
const step = (user, tradeId, name) => user.post(`/api/trades/${tradeId}/${name}`, {});

async function orderRow(id) {
  return (await query('SELECT * FROM orders WHERE id = $1', [id]))[0];
}

async function copyRow(id) {
  return (await query('SELECT owner_id, status FROM copies WHERE id = $1', [id]))[0];
}

async function openAdsOnMarket() {
  const { market } = (await request(app).get(`/api/releases/${RELEASE}/market`).expect(200)).body;
  return {
    forSale: market.forSale.flatMap(({ ads }) => ads.map((ad) => ad.orderId)),
    wanted: market.wanted.map((ad) => ad.orderId),
  };
}

/** A seller lists a copy and a buyer buys it: the trade, awaiting shipment. */
async function makeTrade(seller, buyer, price = '40.00', grade = VG_PLUS) {
  const { copy, order } = await listCopy(seller, price, grade);
  const response = await buy(buyer, order.id).expect(201);
  return { copy, ask: order, ...response.body };
}

/** The same, then the seller ships it. */
async function shippedTrade(seller, buyer, price) {
  const made = await makeTrade(seller, buyer, price);
  await step(seller, made.trade.id, 'ship').expect(200);
  return made;
}

describe('Buy this copy (POST /api/orders/:id/buy)', () => {
  it('buys that exact copy at its asking price and creates a trade awaiting shipment', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    await listCopy(seller, '30.00'); // cheaper, same grade: a WANTED ad would take this one
    const { copy, order: ask } = await listCopy(seller, '45.00');

    const response = await buy(buyer, ask.id).expect(201);

    expect(response.body.trade).toMatchObject({
      copyId: copy.id,
      price: '45.00',
      grade: VG_PLUS,
      status: 'awaiting_shipment',
      role: 'buyer',
      shippedAt: null,
      settledAt: null,
    });
    expect(response.body.order).toMatchObject({
      side: 'bid',
      price: '45.00',
      minGrade: VG_PLUS,
      status: 'filled',
    });
    expect((await orderRow(response.body.order.id)).target_order_id).toBe(ask.id);
    expect((await orderRow(ask.id)).status).toBe('filled');
    expect(await copyStatus(copy.id)).toBe('in_trade');
    expect((await openAdsOnMarket()).forSale).toHaveLength(1); // only the $30 copy is left
  });

  it('takes the price from the buyer and holds nothing extra', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');

    await makeTrade(seller, buyer, '45.00');

    expect(await walletOf(buyer)).toEqual({
      cash: '1955.00',
      held: '0.00',
      spendable: '1955.00',
    });
    // The seller is paid only when the buyer says it arrived.
    expect(await walletOf(seller)).toMatchObject({ cash: '2000.00' });
  });

  it('refuses with INSUFFICIENT_FUNDS when spendable cash is too low, and saves nothing', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { copy, order: ask } = await listCopy(seller, '45.00');
    await placeBid(buyer, '1990.00', NM).expect(201); // holds most of the $2,000

    const response = await buy(buyer, ask.id).expect(400);

    expect(response.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await query('SELECT id FROM trades')).toEqual([]);
    expect(await query(`SELECT id FROM orders WHERE user_id = $1`, [buyer.id])).toHaveLength(1);
    expect((await orderRow(ask.id)).status).toBe('open');
    expect(await copyStatus(copy.id)).toBe('listed');
    expect(await walletOf(buyer)).toMatchObject({ cash: '2000.00', held: '1990.00' });
  });

  it('refuses my own ad', async () => {
    const seller = await signUp('seller');
    const { order: ask } = await listCopy(seller, '45.00');

    const response = await buy(seller, ask.id).expect(400);

    expect(response.body.error.code).toBe('OWN_AD');
    expect((await orderRow(ask.id)).status).toBe('open');
    expect(await query('SELECT id FROM orders WHERE side = $1', ['bid'])).toEqual([]);
  });

  it('answers 409 when the ad was taken or cancelled first (TARGET_UNAVAILABLE), and never rests', async () => {
    const seller = await signUp('seller');
    const first = await signUp('first');
    const late = await signUp('late');
    const { order: taken } = await listCopy(seller, '45.00');
    const { order: cancelled } = await listCopy(seller, '50.00');
    await buy(first, taken.id).expect(201);
    await seller.del(`/api/orders/${cancelled.id}`).expect(200);

    for (const ask of [taken, cancelled]) {
      const response = await buy(late, ask.id).expect(409);
      expect(response.body.error.code).toBe('TARGET_UNAVAILABLE');
    }
    expect(await query('SELECT id FROM orders WHERE user_id = $1', [late.id])).toEqual([]);
    expect(await walletOf(late)).toMatchObject({ cash: '2000.00', held: '0.00' });
    // An id that isn't a FOR SALE ad at all is a 404.
    expect((await buy(late, 999_999).expect(404)).body.error.code).toBe('NOT_FOUND');
    const wanted = (await placeBid(first, '20.00').expect(201)).body.order;
    await buy(late, wanted.id).expect(404);
    await buy(late, 'abc').expect(400);
    await request(app).post(`/api/orders/${taken.id}/buy`).expect(401);
  });

  it('two people pressing Buy at the same moment: one gets it, the other a 409', async () => {
    const seller = await signUp('seller');
    const first = await signUp('first');
    const second = await signUp('second');
    const { order: ask } = await listCopy(seller, '45.00');

    const responses = await Promise.all([buy(first, ask.id), buy(second, ask.id)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await query('SELECT id FROM trades')).toHaveLength(1);
    const spent = [await walletOf(first), await walletOf(second)].map((wallet) => wallet.cash);
    expect(spent.sort()).toEqual(['1955.00', '2000.00']);
  });

  it('ignores any price in the request: the price comes from the ad', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { order: ask } = await listCopy(seller, '45.00', NM);

    const response = await buy(buyer, ask.id, { price: '1.00', minGrade: 1 }).expect(201);

    expect(response.body.trade.price).toBe('45.00');
    expect(response.body.order).toMatchObject({ price: '45.00', minGrade: NM });
    expect(await walletOf(buyer)).toMatchObject({ cash: '1955.00' });
  });
});

describe('Sell to them (POST /api/orders/:id/sell)', () => {
  it('sells my copy at the WANTED ad’s price and releases the buyer’s hold', async () => {
    const buyer = await signUp('buyer');
    const richer = await signUp('richer');
    const seller = await signUp('seller');
    const { order: bid } = (await placeBid(buyer, '50.00', VG_PLUS).expect(201)).body;
    await placeBid(richer, '70.00', VG_PLUS).expect(201); // a better offer, not the one named
    const copy = await addCopy(seller, { grade: NM });

    const response = await sellTo(seller, bid.id, copy.id).expect(201);

    expect(response.body.trade).toMatchObject({
      copyId: copy.id,
      price: '50.00',
      grade: NM,
      role: 'seller',
      status: 'awaiting_shipment',
    });
    expect(response.body.order).toMatchObject({ side: 'ask', price: '50.00', status: 'filled' });
    expect((await orderRow(bid.id)).status).toBe('filled');
    expect(await walletOf(buyer)).toEqual({
      cash: '1950.00',
      held: '0.00',
      spendable: '1950.00',
    });
    expect(await walletOf(richer)).toMatchObject({ held: '70.00' });
    expect(await copyStatus(copy.id)).toBe('in_trade');
  });

  it('refuses a copy below the ad’s lowest grade, someone else’s copy, or one in a trade', async () => {
    const buyer = await signUp('buyer');
    const seller = await signUp('seller');
    const other = await signUp('other');
    const { copy: inTrade } = await makeTrade(seller, other, '10.00', NM);
    const { order: bid } = (await placeBid(buyer, '50.00', NM).expect(201)).body;
    const tooLow = await addCopy(seller, { grade: VG });
    const notMine = await addCopy(other, { grade: NM });
    const OTHER = 1234;
    await query(
      `INSERT INTO releases (id, title, artist, discogs_url) VALUES ($1, 'Other', 'Someone', $2)`,
      [OTHER, `https://www.discogs.com/release/${OTHER}`],
    );
    const [otherPressing] = await query(
      `INSERT INTO copies (owner_id, release_id, grade) VALUES ($1, $2, $3) RETURNING id`,
      [seller.id, OTHER, NM],
    );

    const low = await sellTo(seller, bid.id, tooLow.id).expect(400);
    expect(low.body.error).toMatchObject({ code: 'GRADE_TOO_LOW' });
    expect(low.body.error.fields.copyId).toMatch(/NM or better.*VG/);
    await sellTo(seller, bid.id, notMine.id).expect(404);
    expect((await sellTo(seller, bid.id, inTrade.id).expect(409)).body.error.code).toBe(
      'COPY_NOT_AVAILABLE',
    );
    expect((await sellTo(seller, bid.id, otherPressing.id).expect(400)).body.error.code).toBe(
      'WRONG_PRESSING',
    );
    expect((await seller.post(`/api/orders/${bid.id}/sell`, {}).expect(400)).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await sellTo(buyer, bid.id, notMine.id).expect(400)).body.error.code).toBe('OWN_AD');

    // Nothing was saved by any of them.
    expect((await orderRow(bid.id)).status).toBe('open');
    expect(await walletOf(buyer)).toMatchObject({ cash: '2000.00', held: '50.00' });
    expect(await query('SELECT id FROM trades')).toHaveLength(1); // the setup trade only
    expect(await copyStatus(tooLow.id)).toBe('in_crate');
  });

  it('sells a copy that is already listed: its FOR SALE ad is cancelled in the same transaction', async () => {
    const buyer = await signUp('buyer');
    const seller = await signUp('seller');
    const later = await signUp('later');
    const { order: bid } = (await placeBid(buyer, '50.00', VG_PLUS).expect(201)).body;
    const { copy, order: oldAsk } = await listCopy(seller, '80.00');
    clearAnnouncements();

    const response = await sellTo(seller, bid.id, copy.id).expect(201);

    expect((await orderRow(oldAsk.id)).status).toBe('cancelled');
    expect(response.body.trade).toMatchObject({ copyId: copy.id, price: '50.00' });
    expect(await openAdsOnMarket()).toEqual({ forSale: [], wanted: [] });
    expect(ctx.live.messages).toContainEqual({
      userId: seller.id,
      message: { type: 'order', releaseId: RELEASE, orderId: oldAsk.id, status: 'cancelled' },
    });
    // The book agrees with the database: a new WANTED ad at $100 rests, it doesn't buy the
    // copy whose old $80 ad was cancelled.
    expect((await ctx.orders.book(RELEASE)).asks()).toEqual([]);
    const next = await placeBid(later, '100.00', VG).expect(201);
    expect(next.body.trade).toBeNull();
  });

  it('a listed copy whose sale fails keeps its FOR SALE ad', async () => {
    const buyer = await signUp('buyer');
    const seller = await signUp('seller');
    const { order: bid } = (await placeBid(buyer, '50.00', VG_PLUS).expect(201)).body;
    const { copy, order: oldAsk } = await listCopy(seller, '80.00');
    const failing = hookQueries((sql) => (sql.includes('INSERT INTO trades') ? 'fail' : null));
    try {
      await sellTo(seller, bid.id, copy.id).expect(500);
    } finally {
      failing.mockRestore();
    }

    expect((await orderRow(oldAsk.id)).status).toBe('open');
    expect(await copyStatus(copy.id)).toBe('listed');
    expect((await openAdsOnMarket()).forSale).toEqual([oldAsk.id]);
    await sellTo(seller, bid.id, copy.id).expect(201); // and it works once the database does
  });

  it('answers 409 when the WANTED ad was filled or cancelled first', async () => {
    const buyer = await signUp('buyer');
    const seller = await signUp('seller');
    const quick = await signUp('quick');
    const { order: filled } = (await placeBid(buyer, '50.00', VG).expect(201)).body;
    const { order: cancelled } = (await placeBid(buyer, '60.00', NM).expect(201)).body;
    await listCopy(quick, '50.00', VG); // fills the first WANTED ad straight away
    await buyer.del(`/api/orders/${cancelled.id}`).expect(200);
    const copy = await addCopy(seller, { grade: NM });

    for (const bid of [filled, cancelled]) {
      const response = await sellTo(seller, bid.id, copy.id).expect(409);
      expect(response.body.error.code).toBe('TARGET_UNAVAILABLE');
    }
    expect(await copyStatus(copy.id)).toBe('in_crate');
    expect(await query('SELECT id FROM orders WHERE user_id = $1', [seller.id])).toEqual([]);
  });
});

describe('the trade', () => {
  it('seller ships: awaiting_shipment -> shipped, nothing moves', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { trade, copy } = await makeTrade(seller, buyer, '40.00');

    const response = await step(seller, trade.id, 'ship').expect(200);

    expect(response.body.trade).toMatchObject({
      status: 'shipped',
      role: 'seller',
      settledAt: null,
    });
    expect(Date.parse(response.body.trade.shippedAt)).not.toBeNaN();
    expect(await walletOf(seller)).toMatchObject({ cash: '2000.00' });
    expect(await walletOf(buyer)).toMatchObject({ cash: '1960.00' });
    expect(await copyRow(copy.id)).toEqual({ owner_id: seller.id, status: 'in_trade' });
  });

  it('buyer confirms it arrived: completed, the seller is paid, the copy is now the buyer’s', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { trade, copy } = await shippedTrade(seller, buyer, '40.00');

    const response = await step(buyer, trade.id, 'received').expect(200);

    expect(response.body.trade).toMatchObject({ status: 'completed', role: 'buyer' });
    expect(Date.parse(response.body.trade.settledAt)).not.toBeNaN();
    expect(await walletOf(seller)).toMatchObject({ cash: '2040.00', held: '0.00' });
    expect(await walletOf(buyer)).toMatchObject({ cash: '1960.00' });
    expect(await copyRow(copy.id)).toEqual({ owner_id: buyer.id, status: 'in_crate' });
    // It's really theirs now: in their crate, and they can sell it on. The seller can't.
    const crate = (await buyer.get('/api/crate').expect(200)).body.copies;
    expect(crate.map((item) => item.id)).toEqual([copy.id]);
    await seller.del(`/api/crate/${copy.id}`).expect(404);
    await buyer.post('/api/orders', { side: 'ask', copyId: copy.id, price: '55' }).expect(201);
  });

  it('buyer says not as described after shipping: refunded, the buyer is repaid, the copy goes back', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { trade, copy } = await shippedTrade(seller, buyer, '40.00');

    const response = await step(buyer, trade.id, 'refund').expect(200);

    expect(response.body.trade).toMatchObject({ status: 'refunded' });
    expect(response.body.trade.shippedAt).not.toBeNull();
    expect(await walletOf(buyer)).toMatchObject({ cash: '2000.00', held: '0.00' });
    expect(await walletOf(seller)).toMatchObject({ cash: '2000.00' });
    expect(await copyRow(copy.id)).toEqual({ owner_id: seller.id, status: 'in_crate' });
  });

  it('seller cancels before shipping: refunded, the buyer is repaid, the copy goes back', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { trade, copy } = await makeTrade(seller, buyer, '40.00');

    const response = await step(seller, trade.id, 'cancel').expect(200);

    expect(response.body.trade).toMatchObject({ status: 'refunded', shippedAt: null });
    expect(await walletOf(buyer)).toMatchObject({ cash: '2000.00' });
    expect(await walletOf(seller)).toMatchObject({ cash: '2000.00' });
    expect(await copyRow(copy.id)).toEqual({ owner_id: seller.id, status: 'in_crate' });
    // Back in the crate, so it can be listed again.
    await seller.post('/api/orders', { side: 'ask', copyId: copy.id, price: '35' }).expect(201);
  });

  it('refuses the wrong person (404 for strangers) and the wrong status (409)', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const stranger = await signUp('stranger');
    const { trade } = await makeTrade(seller, buyer, '40.00');

    for (const name of ['ship', 'cancel', 'received', 'refund']) {
      await step(stranger, trade.id, name).expect(404);
    }
    await step(seller, 999_999, 'ship').expect(404);
    await request(app).post(`/api/trades/${trade.id}/ship`).expect(401);
    // The other side of the trade: a 403 that says whose step it is.
    expect((await step(buyer, trade.id, 'ship').expect(403)).body.error.message).toMatch(/seller/);
    expect((await step(buyer, trade.id, 'cancel').expect(403)).body.error.code).toBe(
      'NOT_YOUR_STEP',
    );
    // Not shipped yet: the buyer can't confirm or refund it.
    for (const name of ['received', 'refund']) {
      const response = await step(buyer, trade.id, name).expect(409);
      expect(response.body.error.code).toBe('TRADE_NOT_IN_THAT_STATE');
    }
    await step(seller, trade.id, 'ship').expect(200);
    await step(seller, trade.id, 'ship').expect(409);
    await step(seller, trade.id, 'cancel').expect(409); // too late to back out
    await step(seller, trade.id, 'received').expect(403);
    await step(buyer, trade.id, 'received').expect(200);
    for (const name of ['received', 'refund']) await step(buyer, trade.id, name).expect(409);

    // After all that, money moved exactly once.
    expect(await walletOf(seller)).toMatchObject({ cash: '2040.00' });
    expect(await walletOf(buyer)).toMatchObject({ cash: '1960.00' });
  });

  it('locks both wallets in id order, so two trades between the same people can’t deadlock', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const one = await shippedTrade(alice, bob, '40.00'); // Bob buys from Alice
    const two = await shippedTrade(bob, alice, '25.00'); // Alice buys from Bob
    // Slow every wallet lock down so the two confirmations surely overlap.
    const slow = hookQueries((sql) =>
      sql.includes('FROM users') && sql.includes('FOR UPDATE') ? 50 : null,
    );

    let responses;
    try {
      responses = await Promise.all([
        step(bob, one.trade.id, 'received'),
        step(alice, two.trade.id, 'received'),
      ]);
    } finally {
      slow.mockRestore();
    }

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await walletOf(alice)).toMatchObject({ cash: '2015.00' }); // +40 sold, -25 bought
    expect(await walletOf(bob)).toMatchObject({ cash: '1985.00' });
  });

  it('tells buyer and seller, and the market on a refund, only after the commit', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { trade } = await makeTrade(seller, buyer, '40.00');
    const tradeMessage = (userId, status) => ({
      userId,
      message: { type: 'trade', releaseId: RELEASE, tradeId: trade.id, status },
    });

    // A step whose save fails tells nobody, and changes nothing.
    clearAnnouncements();
    const failing = hookQueries((sql) => (sql.includes('UPDATE trades') ? 'fail' : null));
    try {
      await step(seller, trade.id, 'cancel').expect(500);
    } finally {
      failing.mockRestore();
    }
    expect(ctx.live.messages).toEqual([]);
    expect(ctx.live.markets).toEqual([]);
    expect(await walletOf(buyer)).toMatchObject({ cash: '1960.00' });
    expect((await query('SELECT status FROM trades'))[0].status).toBe('awaiting_shipment');

    // Shipping: both people hear about it; no money moved, so no wallet or market news.
    await step(seller, trade.id, 'ship').expect(200);
    expect(ctx.live.messages).toEqual([
      tradeMessage(buyer.id, 'shipped'),
      tradeMessage(seller.id, 'shipped'),
    ]);
    expect(ctx.live.markets).toEqual([]);

    // A refund: both hear, the buyer's wallet changed, and the Market Report drops the sale.
    clearAnnouncements();
    await step(buyer, trade.id, 'refund').expect(200);
    expect(ctx.live.messages).toEqual([
      tradeMessage(buyer.id, 'refunded'),
      tradeMessage(seller.id, 'refunded'),
      { userId: buyer.id, message: { type: 'wallet', releaseId: RELEASE } },
    ]);
    expect(ctx.live.markets).toEqual([RELEASE]);
  });

  it('a completed trade pays the seller and tells their wallet, and buying tells the market', async () => {
    const seller = await signUp('seller');
    const buyer = await signUp('buyer');
    const { order: ask } = await listCopy(seller, '40.00');
    clearAnnouncements();

    const { trade } = (await buy(buyer, ask.id).expect(201)).body;
    expect(ctx.live.markets).toEqual([RELEASE]);
    expect(ctx.live.messages).toContainEqual({
      userId: seller.id,
      message: {
        type: 'trade',
        releaseId: RELEASE,
        tradeId: trade.id,
        status: 'awaiting_shipment',
      },
    });

    await step(seller, trade.id, 'ship').expect(200);
    clearAnnouncements();
    await step(buyer, trade.id, 'received').expect(200);
    expect(ctx.live.messages).toContainEqual({
      userId: seller.id,
      message: { type: 'wallet', releaseId: RELEASE },
    });
    expect(ctx.live.markets).toEqual([RELEASE]); // completed-trade counts on ads changed
  });

  it('GET /api/trades lists my trades newest first with my role', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const stranger = await signUp('stranger');
    const first = await makeTrade(alice, bob, '40.00'); // Alice sells
    const second = await makeTrade(bob, alice, '25.00'); // Alice buys
    await step(alice, first.trade.id, 'ship').expect(200);

    const { trades } = (await alice.get('/api/trades').expect(200)).body;

    expect(trades.map((trade) => [trade.id, trade.role, trade.status])).toEqual([
      [second.trade.id, 'buyer', 'awaiting_shipment'],
      [first.trade.id, 'seller', 'shipped'],
    ]);
    expect(trades[0]).toMatchObject({
      price: '25.00',
      release: { id: RELEASE, title: expect.any(String), artist: expect.any(String) },
    });
    expect(trades[0]).not.toHaveProperty('buyer_id');
    expect(trades[0]).not.toHaveProperty('sellerId');
    const shipped = (await alice.get('/api/trades?status=shipped').expect(200)).body.trades;
    expect(shipped.map((trade) => trade.id)).toEqual([first.trade.id]);
    expect((await alice.get('/api/trades?status=').expect(200)).body.trades).toHaveLength(2);
    await alice.get('/api/trades?status=lost').expect(400);
    expect((await stranger.get('/api/trades').expect(200)).body.trades).toEqual([]);
    await request(app).get('/api/trades').expect(401);
  });
});

describe('money adds up', () => {
  it('after any mix of trades, completed and refunded, total cash across users is unchanged', async () => {
    const people = await Promise.all(
      ['anna', 'benny', 'cyrus', 'delia'].map((name) => signUp(name)),
    );
    const [ana, ben, cy, dee] = people;
    const totalCash = async () =>
      Number((await query('SELECT sum(cash_cents) AS total FROM users'))[0].total);
    const start = await totalCash();

    // Completed, refunded after shipping, cancelled before shipping, via Buy and Sell to them.
    const completed = await shippedTrade(ana, ben, '40.00');
    await step(ben, completed.trade.id, 'received').expect(200);
    const refunded = await shippedTrade(ben, cy, '33.33');
    await step(cy, refunded.trade.id, 'refund').expect(200);
    const cancelled = await makeTrade(cy, dee, '12.50');
    await step(cy, cancelled.trade.id, 'cancel').expect(200);
    const { order: wanted } = (await placeBid(dee, '61.00', VG).expect(201)).body;
    const sold = (await sellTo(ana, wanted.id, (await addCopy(ana)).id).expect(201)).body.trade;
    await step(ana, sold.id, 'ship').expect(200);
    await step(dee, sold.id, 'received').expect(200);
    // The completed copy changes hands again.
    const resold = (
      await ben.post('/api/orders', { side: 'ask', copyId: completed.copy.id, price: '70' })
    ).body.order;
    const again = (await buy(cy, resold.id).expect(201)).body.trade;
    // While a trade is open, its price sits in the trade, in nobody's cash.
    const inTrades = async () =>
      Number(
        (
          await query(
            `SELECT coalesce(sum(price_cents), 0) AS total FROM trades
              WHERE status IN ('awaiting_shipment', 'shipped')`,
          )
        )[0].total,
      );
    expect((await totalCash()) + (await inTrades())).toBe(start);
    await step(ben, again.id, 'ship').expect(200);
    await step(cy, again.id, 'received').expect(200);

    expect(await inTrades()).toBe(0);
    expect(await totalCash()).toBe(start);
    // Every hold matches an open WANTED ad, and nobody went below zero.
    const users = await query(`SELECT u.cash_cents, u.held_cents,
        coalesce((SELECT sum(price_cents) FROM orders o
                   WHERE o.user_id = u.id AND o.side = 'bid' AND o.status = 'open'), 0) AS open
        FROM users u`);
    for (const user of users) {
      expect(Number(user.held_cents)).toBe(Number(user.open));
      expect(Number(user.cash_cents)).toBeGreaterThanOrEqual(0);
    }
    expect(await walletOf(ben)).toMatchObject({ cash: '2030.00' }); // -40 bought, +70 resold
  });
});
