// PART 1 (Sauransh, week 7). Replace each `it.todo` with a real test.
// The full list of rules is in docs/parts/part-1-matching-engine.md.
import { describe, it } from 'vitest';

describe('OrderBook: incoming bid (WANTED ad)', () => {
  it.todo('fills against the cheapest ask whose grade meets the bid’s minimum grade');
  it.todo('skips a cheaper ask whose grade is below the minimum');
  it.todo('trades at the resting ask’s price, not the bid’s maximum');
  it.todo('rests when no ask is cheap enough or good enough');
});

describe('OrderBook: incoming ask (FOR SALE ad)', () => {
  it.todo('fills against the highest bid that accepts this copy’s grade');
  it.todo('skips a higher bid whose minimum grade is above this copy');
  it.todo('trades at the resting bid’s price');
  it.todo('rests when no bid qualifies');
});

describe('OrderBook: priority and fairness', () => {
  it.todo('equal prices: the earlier order wins');
  it.todo('equal prices and times: the lower id wins');
  it.todo('never matches a user’s own orders, and picks the next eligible one instead');
});

describe('OrderBook: match, apply and remove', () => {
  it.todo('match() does not change the book');
  it.todo('apply() removes the filled resting order and does not rest the incoming one');
  it.todo('apply() rests an incoming order that did not trade');
  it.todo('remove() takes a resting order out and returns it; unknown ids return null');
  it.todo('asks() and bids() come back sorted for display');
});

describe('OrderBook: targeted orders ("Buy this copy" / "Sell to them")', () => {
  it.todo('fills against exactly the targeted resting order when it is eligible');
  it.todo(
    'is rejected with TARGET_UNAVAILABLE (and never rests) when the target is gone or not eligible',
  );
});

describe('order rules (shared/orders.js)', () => {
  it.todo('accepts whole-cent prices from $1.00 to $10,000.00');
  it.todo('rejects bad sides, prices and grades with a clear message');
  it.todo('parses "40", "40.5" and "40.50" into 4000, 4050 and 4050 cents without floats');
  it.todo('formats 4050 cents as "40.50"');
});
