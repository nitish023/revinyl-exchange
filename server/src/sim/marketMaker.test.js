import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, quote } from './marketMaker.js';

describe('quote', () => {
  it('at its target inventory, quotes symmetrically around fair value', () => {
    const q = quote({ fairCents: 4000, sigma: 0.1, inventory: 1 });
    expect(q.reservationCents).toBe(4000);
    // Spread 8% + 0.5 × 10% = 13% of $40 = $5.20.
    expect(q).toMatchObject({ bidCents: 3740, askCents: 4260, spreadCents: 520 });
  });

  it('holding too many copies shades both quotes down; too few, up', () => {
    const flat = quote({ fairCents: 4000, sigma: 0.1, inventory: 1 });
    const long = quote({ fairCents: 4000, sigma: 0.1, inventory: 4 });
    const short = quote({ fairCents: 4000, sigma: 0.1, inventory: 0 });
    expect(long.askCents).toBeLessThan(flat.askCents);
    expect(long.bidCents).toBeLessThan(flat.bidCents);
    expect(short.bidCents).toBeGreaterThan(flat.bidCents);
  });

  it('widens the spread when prices are less certain', () => {
    expect(quote({ fairCents: 4000, sigma: 0.4, inventory: 1 }).spreadCents).toBeGreaterThan(
      quote({ fairCents: 4000, sigma: 0.05, inventory: 1 }).spreadCents,
    );
  });

  it('always quotes a bid under the ask, in whole cents, inside the order limits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.integer({ min: 0, max: 30 }),
        (fairCents, sigma, inventory) => {
          const { bidCents, askCents } = quote({ fairCents, sigma, inventory }, DEFAULT_PARAMS);
          expect(Number.isInteger(bidCents) && Number.isInteger(askCents)).toBe(true);
          expect(bidCents).toBeLessThan(askCents);
          expect(bidCents).toBeGreaterThanOrEqual(100);
          expect(askCents).toBeLessThanOrEqual(1_000_000);
        },
      ),
    );
  });
});
