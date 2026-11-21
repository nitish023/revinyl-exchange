import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { auctionBidSchema, settleAuction, startAuctionSchema } from './auctions.js';

const bid = (id, bidderId, amountCents, at = id) => ({ id, bidderId, amountCents, at });

describe('settleAuction (second price)', () => {
  it('the highest bid wins and pays the second-highest', () => {
    expect(settleAuction([bid(1, 1, 4000), bid(2, 2, 5500), bid(3, 3, 4800)], 2000)).toEqual({
      winner: bid(2, 2, 5500),
      priceCents: 4800,
    });
  });

  it('a lone bid pays the reserve', () => {
    expect(settleAuction([bid(1, 1, 9000)], 2500)).toEqual({
      winner: bid(1, 1, 9000),
      priceCents: 2500,
    });
  });

  it('pays the reserve when the second bid is below it, and ignores bids under the reserve', () => {
    expect(settleAuction([bid(1, 1, 1500), bid(2, 2, 6000)], 3000).priceCents).toBe(3000);
    expect(settleAuction([bid(1, 1, 1500)], 3000)).toBeNull();
    expect(settleAuction([], 3000)).toBeNull();
  });

  it('a tie goes to the earlier bid, at that price', () => {
    expect(settleAuction([bid(2, 2, 5000, 20), bid(1, 1, 5000, 10)], 1000)).toEqual({
      winner: bid(1, 1, 5000, 10),
      priceCents: 5000,
    });
  });

  it('never charges the winner more than their bid, or less than the reserve', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 100, max: 100_000 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 100, max: 100_000 }),
        (amounts, reserve) => {
          const result = settleAuction(
            amounts.map((amount, i) => bid(i, i, amount)),
            reserve,
          );
          if (result === null) {
            expect(Math.max(...amounts)).toBeLessThan(reserve);
            return;
          }
          expect(result.priceCents).toBeLessThanOrEqual(result.winner.amountCents);
          expect(result.priceCents).toBeGreaterThanOrEqual(reserve);
          expect(result.winner.amountCents).toBe(Math.max(...amounts));
        },
      ),
    );
  });
});

describe('why you should bid what it’s worth to you', () => {
  // What a bidder who values the copy at `value` gains: value - price if they win, else 0.
  const gain = (value, myBid, rivals, reserve) => {
    const all = [
      bid(0, 0, myBid, 0),
      ...rivals.map((amount, i) => bid(i + 1, i + 1, amount, i + 1)),
    ];
    const result = settleAuction(all, reserve);
    return result && result.winner.bidderId === 0 ? value - result.priceCents : 0;
  };

  it('bidding your true value does at least as well as any other bid, whatever the rivals do', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 50_000 }), // what the copy is worth to me
        fc.integer({ min: 100, max: 50_000 }), // a different bid I might try instead
        fc.array(fc.integer({ min: 100, max: 50_000 }), { maxLength: 6 }), // everyone else
        fc.integer({ min: 100, max: 20_000 }), // the reserve
        (value, other, rivals, reserve) => {
          expect(gain(value, value, rivals, reserve)).toBeGreaterThanOrEqual(
            gain(value, other, rivals, reserve),
          );
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('while a first-price auction (pay your own bid) rewards shading your bid down', () => {
    // The same bidder, paying their own bid instead: bidding their value always gains 0,
    // and a lower winning bid gains more. That's why second price makes honesty pay.
    const value = 5000;
    const firstPrice = (myBid, rival) => (myBid > rival ? value - myBid : 0);
    expect(firstPrice(value, 3000)).toBe(0);
    expect(firstPrice(3100, 3000)).toBe(1900);
  });
});

describe('requests', () => {
  it('starting an auction: a copy, a reserve in dollars and one of the lengths', () => {
    expect(startAuctionSchema.parse({ copyId: 4, reserve: '20', days: 3 })).toEqual({
      copyId: 4,
      reserve: 2000,
      days: 3,
    });
    expect(startAuctionSchema.safeParse({ copyId: 4, reserve: '20', days: 2 }).success).toBe(false);
    expect(auctionBidSchema.parse({ amount: '40.50' })).toEqual({ amount: 4050 });
    expect(auctionBidSchema.safeParse({ amount: '0.50' }).success).toBe(false);
  });
});
