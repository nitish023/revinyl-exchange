import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  basisPoints,
  payoutFor,
  percentText,
  reliabilityText,
  trustScoreText,
  roundHalfEven,
  SELLER_LEVELS,
  standingOf,
  wilsonLowerBound,
} from './fees.js';

const PRICE = fc.integer({ min: 100, max: 1_000_000 }); // the order price limits, in cents
const LEVEL = fc.integer({ min: 1, max: 5 });

describe('roundHalfEven (banker’s rounding)', () => {
  it.each([
    [5, 2, 2], // 2.5 -> 2 (even)
    [7, 2, 4], // 3.5 -> 4 (even)
    [25, 10, 2],
    [35, 10, 4],
    [26, 10, 3],
    [24, 10, 2],
    [0, 7, 0],
  ])('%i / %i = %i', (a, b, expected) => {
    expect(roundHalfEven(a, b)).toBe(expected);
  });

  it('is never more than half away from the exact answer', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10 ** 12 }), fc.integer({ min: 1, max: 10 ** 6 }), (a, b) => {
        expect(Math.abs(roundHalfEven(a, b) - a / b)).toBeLessThanOrEqual(0.5);
      }),
    );
  });

  it('comes out even over every half: as many rounded down as up', () => {
    let drift = 0;
    for (let a = 1; a < 20_000; a += 2) drift += roundHalfEven(a, 2) - a / 2;
    expect(drift).toBe(0);
  });

  it('refuses fractions and negatives: money is whole cents', () => {
    expect(() => roundHalfEven(1.5, 2)).toThrow(RangeError);
    expect(() => roundHalfEven(-1, 2)).toThrow(RangeError);
    expect(() => roundHalfEven(1, 0)).toThrow(RangeError);
  });
});

describe('payoutFor', () => {
  it('a $40 sale at level 1: 9% + 3% = $4.80, so $35.20 is paid out', () => {
    expect(payoutFor(4000, 1)).toEqual({
      transactionFeeCents: 360,
      processingFeeCents: 120,
      feeCents: 480,
      payoutCents: 3520,
      feeBps: 1200,
    });
  });

  it('rounds each part exactly: $40.50 at 3% is $1.215, which rounds to the even $1.22', () => {
    expect(payoutFor(4050, 3)).toMatchObject({ processingFeeCents: 122, transactionFeeCents: 324 });
    expect(basisPoints(4050, 300)).toBe(122);
  });

  it('for every price and level: the fee and payout add up to the price, to the cent', () => {
    fc.assert(
      fc.property(PRICE, LEVEL, (price, level) => {
        const { feeCents, payoutCents, transactionFeeCents, processingFeeCents } = payoutFor(
          price,
          level,
        );
        expect(feeCents + payoutCents).toBe(price);
        expect(transactionFeeCents + processingFeeCents).toBe(feeCents);
        for (const cents of [feeCents, payoutCents]) expect(Number.isInteger(cents)).toBe(true);
        expect(payoutCents).toBeGreaterThan(0);
      }),
    );
  });

  it('a higher level never pays more, and a dearer sale never pays out less', () => {
    fc.assert(
      fc.property(
        PRICE,
        fc.integer({ min: 1, max: 4 }),
        fc.nat({ max: 1000 }),
        (price, level, extra) => {
          expect(payoutFor(price, level + 1).feeCents).toBeLessThanOrEqual(
            payoutFor(price, level).feeCents,
          );
          expect(payoutFor(price + extra, level).payoutCents).toBeGreaterThanOrEqual(
            payoutFor(price, level).payoutCents,
          );
        },
      ),
    );
  });

  it('refuses a level that doesn’t exist', () => {
    expect(() => payoutFor(4000, 6)).toThrow(/no seller level 6/);
  });
});

describe('wilsonLowerBound', () => {
  // Published values of the 95% Wilson interval's lower bound.
  it.each([
    [5, 10, 0.2366],
    [9, 10, 0.5958],
    [98, 100, 0.93],
    [1, 1, 0.2065],
    [0, 5, 0],
  ])('%i out of %i: %f', (successes, total, expected) => {
    expect(wilsonLowerBound(successes, total)).toBeCloseTo(expected, 4);
  });

  it('is 0 with no record, and always between 0 and the plain success rate', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.nat(), (total, seed) => {
        const successes = seed % (total + 1);
        const bound = wilsonLowerBound(successes, total);
        expect(bound).toBeGreaterThanOrEqual(0);
        expect(bound).toBeLessThanOrEqual(successes / total + 1e-12);
      }),
    );
  });

  it('trusts a long record more than a short one with the same rate', () => {
    expect(wilsonLowerBound(98, 100)).toBeGreaterThan(wilsonLowerBound(49, 50));
    expect(wilsonLowerBound(49, 50)).toBeGreaterThan(wilsonLowerBound(1, 1));
  });
});

describe('standingOf: a seller’s level', () => {
  const record = (sales90, volume90Cents, completed = sales90, refunded = 0) => ({
    sales90,
    volume90Cents,
    completed,
    refunded,
  });

  it('starts everyone at level 1, with what level 2 needs', () => {
    expect(standingOf(record(0, 0))).toMatchObject({
      level: 1,
      feeBps: 1200,
      next: { level: 2, salesNeeded: 3, volumeNeededCents: 10_000, reliabilityNeeded: 0 },
    });
  });

  it('needs every threshold of a level: sales, volume and, at the top, reliability', () => {
    expect(standingOf(record(3, 9_999)).level).toBe(1); // a cent short of $100
    expect(standingOf(record(3, 10_000)).level).toBe(2);
    expect(standingOf(record(25, 150_000)).level).toBe(4);
    // Same volume, but 8 refunds out of 33: not reliable enough for 4.
    const shaky = standingOf(record(25, 150_000, 25, 8));
    expect(shaky.level).toBe(3);
    expect(shaky.next).toMatchObject({ level: 4, salesNeeded: 0, reliabilityNeeded: 0.8 });
    expect(standingOf(record(80, 900_000)).level).toBe(5);
    expect(standingOf(record(80, 900_000)).next).toBeNull();
  });

  it('levels and fees step down together', () => {
    const fees = SELLER_LEVELS.map((tier) => tier.transactionFeeBps);
    expect(fees).toEqual([...fees].sort((a, b) => b - a));
  });
});

describe('words', () => {
  it('fees as percentages', () => {
    expect(percentText(1200)).toBe('12%');
    expect(percentText(1150)).toBe('11.5%');
  });

  it('a seller is "New" until three settled sales, then their reliability', () => {
    expect(reliabilityText({ completed: 2, refunded: 0 })).toBe('New seller');
    expect(reliabilityText({ completed: 98, refunded: 2 })).toBe('98% of sales completed');
    expect(reliabilityText({ completed: 2, refunded: 1 })).toBe('66% of sales completed'); // never rounded up
  });
});

it('explains the trust score to the seller', () => {
  expect(trustScoreText({ completed: 3, refunded: 0 })).toBe(
    'Trust score 44 out of 100: from 3 completed and 0 refunded sales, we’re 95% sure at ' +
      'least 44% of your sales go through. It rises as your record grows.',
  );
});
