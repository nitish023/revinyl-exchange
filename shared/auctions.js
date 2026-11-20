/**
 * Sealed-bid second-price auctions (Part 16), shared by the browser and the server.
 * Spec: docs/parts/part-16-auctions.md.
 *
 * A seller puts one copy up with a reserve price and an end. Bidders can't see each other's
 * bids. When it ends, the highest bid at or above the reserve wins and pays the second-
 * highest bid, or the reserve if that's more (a Vickrey auction). Because the winner never
 * pays their own bid, the best thing any bidder can do is bid exactly what the copy is worth
 * to them: bidding less only risks losing a copy they'd have paid less than that for, and
 * bidding more only risks winning at a price above what it's worth (auctions.test.js checks
 * this for every combination of rival bids).
 */
import { z } from 'zod';
import { idSchema, parseDollars, priceCentsSchema } from './orders.js';

/** How long an auction can run. */
export const AUCTION_DAYS = Object.freeze([1, 3, 7]);

/**
 * @typedef {object} SealedBid
 * @property {number} id
 * @property {number} bidderId
 * @property {number} amountCents
 * @property {number} at when it was placed (ms), to break ties: the earlier bid wins
 */

/**
 * Who wins and what they pay.
 * @param {SealedBid[]} bids
 * @param {number} reserveCents
 * @returns {{ winner: SealedBid, priceCents: number } | null} null when no bid meets the reserve
 */
export function settleAuction(bids, reserveCents) {
  const valid = bids
    .filter((bid) => bid.amountCents >= reserveCents)
    .sort((a, b) => b.amountCents - a.amountCents || a.at - b.at || a.id - b.id);
  if (valid.length === 0) return null;
  const [winner, runnerUp] = valid;
  return { winner, priceCents: Math.max(reserveCents, runnerUp?.amountCents ?? reserveCents) };
}

const priceText = (message) =>
  z
    .string({ error: message })
    .transform((text) => parseDollars(text))
    .pipe(priceCentsSchema);

/** POST /api/auctions: put a copy up. */
export const startAuctionSchema = z.object({
  copyId: idSchema('Pick the copy to auction'),
  reserve: priceText('Enter a reserve like 20.00'),
  days: z
    .number({ error: 'Pick how long the auction runs' })
    .refine((days) => AUCTION_DAYS.includes(days), 'Pick how long the auction runs'),
});

/** POST /api/auctions/:id/bids: a sealed bid, or a higher one to replace yours. */
export const auctionBidSchema = z.object({
  amount: priceText('Enter your bid like 40.00'),
});
