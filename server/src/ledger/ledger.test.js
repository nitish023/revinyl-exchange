import { describe, expect, it } from 'vitest';
import { assertBalanced, tradeJournals } from './ledger.js';

const trade = { id: 7, buyer_id: 1, seller_id: 2, price_cents: 4000, seller_fee_cents: 360 };
const sum = (journal) => journal.lines.reduce((total, line) => total + line.amountCents, 0);

describe('trade journals', () => {
  it('payment: the buyer’s price goes into escrow', () => {
    expect(tradeJournals.payment(trade)).toEqual({
      kind: 'trade_payment',
      tradeId: 7,
      lines: [
        { account: 'cash', userId: 1, amountCents: -4000 },
        { account: 'escrow', amountCents: 4000 },
      ],
    });
  });

  it('payout: escrow pays the seller the price less the fee, and the fee to reVINYL', () => {
    expect(tradeJournals.payout(trade).lines).toEqual([
      { account: 'escrow', amountCents: -4000 },
      { account: 'cash', userId: 2, amountCents: 3640 },
      { account: 'fees', amountCents: 360 },
    ]);
    // No fee, no fee entry (a zero entry isn't allowed).
    expect(tradeJournals.payout({ ...trade, seller_fee_cents: 0 }).lines).toHaveLength(2);
  });

  it('refund: escrow gives the buyer everything back', () => {
    expect(tradeJournals.refund(trade).lines).toEqual([
      { account: 'escrow', amountCents: -4000 },
      { account: 'cash', userId: 1, amountCents: 4000 },
    ]);
  });

  it('every journal balances, so it passes the check', () => {
    for (const make of Object.values(tradeJournals)) {
      const journal = make(trade);
      expect(sum(journal)).toBe(0);
      expect(() => assertBalanced(journal)).not.toThrow();
    }
  });
});

describe('assertBalanced', () => {
  const ok = {
    kind: 'adjustment',
    lines: [
      { account: 'cash', userId: 1, amountCents: -100 },
      { account: 'cash', userId: 2, amountCents: 100 },
    ],
  };

  it('accepts a journal whose entries add up to zero', () => {
    expect(() => assertBalanced(ok)).not.toThrow();
  });

  it.each([
    [
      'doesn’t add up to zero',
      { ...ok, lines: [ok.lines[0], { ...ok.lines[1], amountCents: 99 }] },
      /off by -1/,
    ],
    ['has one entry', { ...ok, lines: [ok.lines[0]] }, /at least two/],
    [
      'has a zero entry',
      { ...ok, lines: [...ok.lines, { account: 'fees', amountCents: 0 }] },
      /non-zero/,
    ],
    [
      'has fractional cents',
      {
        ...ok,
        lines: [
          { ...ok.lines[0], amountCents: -0.5 },
          { ...ok.lines[1], amountCents: 0.5 },
        ],
      },
      /whole/,
    ],
    [
      'has a cash entry without a user',
      {
        ...ok,
        lines: [
          { account: 'cash', amountCents: -1 },
          { account: 'fees', amountCents: 1 },
        ],
      },
      /cash entry needs a user/,
    ],
    [
      'gives a user to escrow',
      {
        ...ok,
        lines: [
          { account: 'escrow', userId: 3, amountCents: -1 },
          { account: 'fees', amountCents: 1 },
        ],
      },
      /only a cash entry/,
    ],
    [
      'uses an unknown account',
      {
        ...ok,
        lines: [
          { account: 'vault', amountCents: -1 },
          { account: 'fees', amountCents: 1 },
        ],
      },
      /Unknown account/,
    ],
    [
      'is a trade journal without its trade',
      { ...tradeJournals.payment(trade), tradeId: undefined },
      /name their trade/,
    ],
    ['is an adjustment naming a trade', { ...ok, tradeId: 7 }, /name their trade/],
  ])('refuses a journal that %s', (_what, journal, message) => {
    expect(() => assertBalanced(journal)).toThrow(message);
  });
});
