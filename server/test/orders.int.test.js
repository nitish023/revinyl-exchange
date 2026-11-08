/**
 * Part 3 checklist (Sauransh). Turn every it.todo into a real test. Each test starts from
 * an empty database; seedDemo(ctx.pool) gives you traders and a market if you need one,
 * and ctx.live records what was announced (RecordingLiveUpdates in helpers.js).
 */
import { describe, it } from 'vitest';

describe('wallet', () => {
  it.todo('a new account starts with $2,000 and nothing held');
  it.todo('GET /api/wallet needs a login and shows cash, held and spendable');
});

describe('crate', () => {
  it.todo('adds a copy with grade, sleeve grade (or generic), flags, headline and notes');
  it.todo('caches the pressing first (ctx.catalog.ensureRelease) and 404s a non-vinyl release');
  it.todo('rejects a bad grade, an unknown flag, or notes over 500 characters with field messages');
  it.todo('lists only my own copies');
  it.todo('removes a copy only while it is in the crate (not listed, not in a trade)');
  it.todo('stores a photo (jpeg, png or webp, up to 2 MB, up to 6 per copy) and serves it back');
});

describe('placing a wanted ad (bid)', () => {
  it.todo('holds the price and rests when nothing matches');
  it.todo('refuses with INSUFFICIENT_FUNDS when spendable cash is too low, and holds nothing');
  it.todo('fills against the cheapest good-enough copy at the ask price, not the bid price');
  it.todo('creates a trade awaiting shipment, takes the price from the buyer, copy goes in_trade');
  it.todo('skips my own ask and takes the next one');
  it.todo('announces the market change and tells buyer and seller after the commit');
});

describe('placing a FOR SALE ad (ask)', () => {
  it.todo('lists a copy from my crate and rests when nothing matches');
  it.todo('refuses a copy that is not mine, or not in my crate (404 / 409)');
  it.todo('fills against the highest bid it qualifies for, at the bid price');
  it.todo('releases the buyer’s hold and takes the trade price from their cash');
});

describe('cancelling', () => {
  it.todo('cancels my open bid and gives the held cash back');
  it.todo('cancels my open ask and puts the copy back in the crate');
  it.todo('refuses someone else’s order (404) and a filled or cancelled one (409)');
  it.todo('removes the order from the book so it can no longer match');
});

describe('keeping the book and the database in step', () => {
  it.todo('two bids for the same last copy at the same moment: exactly one trade');
  it.todo('a failed transaction leaves the book unchanged (match, then save, then apply)');
  it.todo('the book loads open orders from the database the first time a pressing is used');
});
