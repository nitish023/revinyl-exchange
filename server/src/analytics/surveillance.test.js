import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findWashTrades, withoutWashTrades } from './surveillance.js';

const DAY = 86_400_000;
let nextId = 1;
const trade = (copyId, sellerId, buyerId, day) => ({
  id: nextId++,
  copyId,
  sellerId,
  buyerId,
  at: day * DAY,
});
const reasons = (flags, t) => [...(flags.get(t.id) ?? [])].sort();

describe('round trips', () => {
  it('flags a copy sold and bought back (A→B→A) within 30 days', () => {
    const out = trade(1, 10, 20, 0);
    const back = trade(1, 20, 10, 5);
    const flags = findWashTrades([out, back]);
    expect(reasons(flags, out)).toEqual(['round_trip']);
    expect(reasons(flags, back)).toEqual(['round_trip']);
  });

  it('flags every leg of a ring (A→B→C→A)', () => {
    const legs = [trade(1, 10, 20, 0), trade(1, 20, 30, 3), trade(1, 30, 10, 6)];
    const flags = findWashTrades(legs);
    for (const leg of legs) expect(reasons(flags, leg)).toEqual(['round_trip']);
  });

  it('leaves alone a copy that comes back after more than 30 days, or never comes back', () => {
    expect(findWashTrades([trade(1, 10, 20, 0), trade(1, 20, 10, 31)]).size).toBe(0);
    expect(
      findWashTrades([trade(1, 10, 20, 0), trade(1, 20, 30, 2), trade(1, 30, 40, 4)]).size,
    ).toBe(0);
  });
});

describe('pair churn', () => {
  it('flags the same two people trading three times in 30 days, either way round', () => {
    const three = [trade(1, 10, 20, 0), trade(2, 20, 10, 10), trade(3, 10, 20, 20)];
    const flags = findWashTrades(three);
    for (const t of three) expect(reasons(flags, t)).toContain('pair_churn');
  });

  it('two trades, or three spread over more than 30 days, are just two collectors', () => {
    expect(findWashTrades([trade(1, 10, 20, 0), trade(2, 10, 20, 10)]).size).toBe(0);
    expect(
      findWashTrades([trade(1, 10, 20, 0), trade(2, 10, 20, 20), trade(3, 10, 20, 40)]).size,
    ).toBe(0);
  });
});

describe('an honest market', () => {
  it('flags nothing when every copy only moves on and nobody trades with one person thrice', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 120 }), { maxLength: 60 }), (days) => {
        // Each trade a new copy, between a new pair of people.
        const trades = days.map((day, i) => trade(1000 + i, 2 * i, 2 * i + 1, day));
        expect(findWashTrades(trades).size).toBe(0);
        expect(withoutWashTrades(trades)).toEqual(trades);
      }),
    );
  });

  it('keeps the clean trades and drops the flagged ones', () => {
    const honest = trade(9, 1, 2, 0);
    const wash = [trade(1, 10, 20, 0), trade(1, 20, 10, 1)];
    expect(withoutWashTrades([honest, ...wash])).toEqual([honest]);
  });
});
