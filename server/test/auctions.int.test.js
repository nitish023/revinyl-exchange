/**
 * Part 16: sealed-bid second-price auctions against the real database. Every test ends with
 * the exchange's rules (including the auction rules: holds, copies, bids and prices).
 */
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestContext, expectExchangeConsistent, resetDatabase } from './helpers.js';
import { RELEASE, traders } from './traders.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });
const { query, signUp, addCopy, walletOf, copyStatus, setCash } = traders(ctx, app);

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.orders.books.clear();
});
afterEach(() => expectExchangeConsistent(ctx));
afterAll(() => ctx.pool.end());

/** A seller puts a fresh copy up with a $20 reserve for 3 days. */
async function auction(seller, reserve = '20.00') {
  const copy = await addCopy(seller);
  const { auction: started } = (
    await seller.post('/api/auctions', { copyId: copy.id, reserve, days: 3 }).expect(201)
  ).body;
  return { copy, auction: started };
}
const bid = (user, auctionId, amount) => user.post(`/api/auctions/${auctionId}/bids`, { amount });
/** Pretend the auction ended a minute ago. */
const end = (auctionId) =>
  query(
    `UPDATE auctions SET created_at = now() - interval '3 days', ends_at = now() - interval '1 minute'
      WHERE id = $1`,
    [auctionId],
  );
const listing = async () =>
  (await request(app).get(`/api/releases/${RELEASE}/auctions`).expect(200)).body.auctions;

describe('starting an auction', () => {
  it('takes the copy out of the crate and puts it on the pressing’s page', async () => {
    const ana = await signUp('anna');
    const { copy, auction: started } = await auction(ana);
    expect(started).toMatchObject({ reserve: '20.00', status: 'open', bids: 0, mine: true });
    expect(await copyStatus(copy.id)).toBe('in_auction');
    const { open } = await listing();
    expect(open.map((a) => a.id)).toEqual([started.id]);
    expect((Date.parse(open[0].endsAt) - Date.now()) / 86_400_000).toBeCloseTo(3, 1);
  });

  it('a copy up for auction can’t also be listed or sold to a wanted ad', async () => {
    const [ana, ben] = [await signUp('anna'), await signUp('benny')];
    const { copy } = await auction(ana);
    await ana.post('/api/orders', { side: 'ask', copyId: copy.id, price: '30' }).expect(409);
    const { order } = (
      await ben
        .post('/api/orders', { side: 'bid', releaseId: RELEASE, price: '90', minGrade: 1 })
        .expect(201)
    ).body;
    const refused = await ana.post(`/api/orders/${order.id}/sell`, { copyId: copy.id }).expect(409);
    expect(refused.body.error.message).toBe('That copy is up for auction.');
  });

  it('refuses a copy that isn’t in the crate, and a length that isn’t offered', async () => {
    const ana = await signUp('anna');
    const { copy } = await auction(ana);
    await ana.post('/api/auctions', { copyId: copy.id, reserve: '20', days: 3 }).expect(409);
    const other = await addCopy(ana);
    await ana.post('/api/auctions', { copyId: other.id, reserve: '20', days: 2 }).expect(400);
  });
});

describe('sealed bids', () => {
  it('each bid holds its amount, and nobody sees anyone else’s', async () => {
    const [ana, ben, cy] = await Promise.all(['anna', 'benny', 'cyrus'].map((n) => signUp(n)));
    const { auction: a } = await auction(ana);
    await bid(ben, a.id, '45.00').expect(201);
    await bid(cy, a.id, '30.00').expect(201);
    expect(await walletOf(ben)).toMatchObject({ held: '45.00', spendable: '1955.00' });
    const asBen = (await ben.get(`/api/auctions/${a.id}`).expect(200)).body.auction;
    expect(asBen).toMatchObject({ bids: 2, myBid: '45.00' });
    const asGuest = (await request(app).get(`/api/auctions/${a.id}`).expect(200)).body.auction;
    expect(asGuest).toMatchObject({ bids: 2, myBid: null });
    expect(JSON.stringify(await listing())).not.toMatch(/45\.00|30\.00/);
  });

  it('a raise replaces your bid and holds only the difference; a lower bid is refused', async () => {
    const [ana, ben] = [await signUp('anna'), await signUp('benny')];
    const { auction: a } = await auction(ana);
    await bid(ben, a.id, '30.00').expect(201);
    await bid(ben, a.id, '50.00').expect(201);
    expect(await walletOf(ben)).toMatchObject({ held: '50.00' });
    const lower = await bid(ben, a.id, '40.00').expect(400);
    expect(lower.body.error.code).toBe('BID_NOT_HIGHER');
  });

  it('refuses a bid under the reserve, on your own auction, without the cash, or after the end', async () => {
    const [ana, ben] = [await signUp('anna'), await signUp('benny')];
    const { auction: a } = await auction(ana, '25.00');
    expect((await bid(ben, a.id, '24.99').expect(400)).body.error.code).toBe('BELOW_RESERVE');
    expect((await bid(ana, a.id, '30.00').expect(400)).body.error.code).toBe('OWN_AUCTION');
    await setCash(ben, 2000);
    expect((await bid(ben, a.id, '30.00').expect(400)).body.error.code).toBe('INSUFFICIENT_FUNDS');
    await end(a.id);
    expect((await bid(ben, a.id, '10.00').expect(409)).body.error.code).toBe('AUCTION_CLOSED');
  });
});

describe('settling', () => {
  it('the highest bid wins and pays the second-highest; every other hold comes back', async () => {
    const [ana, ben, cy, dee] = await Promise.all(
      ['anna', 'benny', 'cyrus', 'delia'].map((n) => signUp(n)),
    );
    const { copy, auction: a } = await auction(ana);
    await bid(ben, a.id, '40.00').expect(201);
    await bid(cy, a.id, '55.00').expect(201);
    await bid(dee, a.id, '48.00').expect(201);
    expect(await ctx.auctions.settle(a.id)).toBe(false); // not over yet
    await end(a.id);
    expect(await ctx.auctions.settleDue()).toBe(1);

    const [trade] = await query('SELECT * FROM trades');
    expect(trade).toMatchObject({ buyer_id: cy.id, seller_id: ana.id, price_cents: 4800 });
    expect(await walletOf(cy)).toMatchObject({ cash: '1952.00', held: '0.00' });
    for (const loser of [ben, dee]) {
      expect(await walletOf(loser)).toMatchObject({ cash: '2000.00', held: '0.00' });
    }
    expect(await copyStatus(copy.id)).toBe('in_trade');
    const { results } = await listing();
    expect(results[0]).toMatchObject({ status: 'sold', price: '48.00', bids: 3 });

    // From here it's an ordinary trade: shipped, accepted, the seller paid less their fee.
    await ana.post(`/api/trades/${trade.id}/ship`, {}).expect(200);
    await cy.post(`/api/trades/${trade.id}/received`, {}).expect(200);
    expect(await walletOf(ana)).toMatchObject({ cash: '2042.24' }); // $48 less 12%
    expect(await ctx.auctions.settleDue()).toBe(0); // settled once
  });

  it('a lone bid pays the reserve', async () => {
    const [ana, ben] = [await signUp('anna'), await signUp('benny')];
    const { auction: a } = await auction(ana, '25.00');
    await bid(ben, a.id, '90.00').expect(201);
    await end(a.id);
    await ctx.auctions.settleDue();
    expect((await query('SELECT price_cents FROM trades'))[0].price_cents).toBe(2500);
  });

  it('no bids: unsold, and the copy goes back to the crate', async () => {
    const ana = await signUp('anna');
    const { copy, auction: a } = await auction(ana);
    await end(a.id);
    await ctx.auctions.settleDue();
    expect(await copyStatus(copy.id)).toBe('in_crate');
    expect((await listing()).results[0]).toMatchObject({ status: 'unsold', price: null });
  });

  it('many bids and the settlement racing each other still add up', async () => {
    const seller = await signUp('sella');
    const bidders = await Promise.all(Array.from({ length: 8 }, (_, i) => signUp(`bidder${i}`)));
    const { auction: a } = await auction(seller);
    await Promise.all(bidders.map((user, i) => bid(user, a.id, String(30 + i * 3))));
    await end(a.id);
    // Two settles at once (two server processes): exactly one does it.
    const done = await Promise.all([ctx.auctions.settle(a.id), ctx.auctions.settle(a.id)]);
    expect(done.filter(Boolean)).toHaveLength(1);
    // Bids of $30, $33, ... $51: the $51 bid wins and pays the second-highest, $48.
    expect(await query('SELECT price_cents FROM trades')).toEqual([{ price_cents: 4800 }]);
  });
});

describe('taking an auction down', () => {
  it('the seller can, while nobody has bid; the copy goes back to the crate', async () => {
    const [ana, ben] = [await signUp('anna'), await signUp('benny')];
    const { copy, auction: a } = await auction(ana);
    await ben.del(`/api/auctions/${a.id}`).expect(404);
    await ana.del(`/api/auctions/${a.id}`).expect(200);
    expect(await copyStatus(copy.id)).toBe('in_crate');
    const { auction: other } = await auction(ana);
    await bid(ben, other.id, '30.00').expect(201);
    expect((await ana.del(`/api/auctions/${other.id}`).expect(409)).body.error.code).toBe(
      'AUCTION_HAS_BIDS',
    );
  });
});
