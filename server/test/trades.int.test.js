/**
 * Part 5 checklist (Sauransh). Turn every it.todo into a real test. Each test starts from an
 * empty database; ctx.live records what was announced (RecordingLiveUpdates in helpers.js).
 */
import { describe, it } from 'vitest';

describe('Buy this copy (POST /api/orders/:id/buy)', () => {
  it.todo('buys that exact copy at its asking price and creates a trade awaiting shipment');
  it.todo('takes the price from the buyer and holds nothing extra');
  it.todo('refuses with INSUFFICIENT_FUNDS when spendable cash is too low, and saves nothing');
  it.todo('refuses my own ad');
  it.todo(
    'answers 409 when the ad was taken or cancelled first (TARGET_UNAVAILABLE), and never rests',
  );
  it.todo('ignores any price in the request: the price comes from the ad');
});

describe('Sell to them (POST /api/orders/:id/sell)', () => {
  it.todo('sells my copy at the WANTED ad’s price and releases the buyer’s hold');
  it.todo('refuses a copy below the ad’s lowest grade, someone else’s copy, or one in a trade');
  it.todo(
    'sells a copy that is already listed: its FOR SALE ad is cancelled in the same transaction',
  );
  it.todo('answers 409 when the WANTED ad was filled or cancelled first');
});

describe('the trade', () => {
  it.todo('seller ships: awaiting_shipment -> shipped, nothing moves');
  it.todo('buyer confirms it arrived: completed, the seller is paid, the copy is now the buyer’s');
  it.todo(
    'buyer says not as described after shipping: refunded, the buyer is repaid, the copy goes back',
  );
  it.todo('seller cancels before shipping: refunded, the buyer is repaid, the copy goes back');
  it.todo('refuses the wrong person (404 for strangers) and the wrong status (409)');
  it.todo('locks both wallets in id order, so two trades between the same people can’t deadlock');
  it.todo('tells buyer and seller, and the market on a refund, only after the commit');
  it.todo('GET /api/trades lists my trades newest first with my role');
});

describe('money adds up', () => {
  it.todo('after any mix of trades, completed and refunded, total cash across users is unchanged');
});
