import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildIndex, INDEX_BASE } from './marketIndex.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const sale = (releaseId, priceCents, daysAgo) => ({
  releaseId,
  priceCents,
  at: NOW - daysAgo * DAY,
});
const levelOn = (index, daysAgo) =>
  index.series.find(
    (point) => point.day === new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10),
  )?.level;

describe('buildIndex', () => {
  it('starts at 1,000 and follows a single pressing’s price', () => {
    const index = buildIndex([sale(1, 2000, 9), sale(1, 3000, 2)], { now: NOW, days: 10 });
    expect(index.series[0].level).toBe(INDEX_BASE);
    expect(levelOn(index, 2)).toBeCloseTo(1500, 8); // $20 → $30 is +50%
    expect(index.members).toEqual([
      { releaseId: 1, shares: expect.any(Number), priceCents: 3000, weight: 1 },
    ]);
  });

  it('weights members by the money traded in them, as of the last rebalance', () => {
    const sales = [sale(1, 1000, 5), sale(1, 1000, 4), sale(1, 1000, 3), sale(2, 1000, 5)];
    // Weekly: chosen on the first day, when each had traded $10, and held since.
    const weekly = buildIndex(sales, { now: NOW, days: 6 });
    expect(weekly.members.map((m) => m.weight)).toEqual([0.5, 0.5]);
    // Rebalanced today: $30 of the $40 traded is in pressing 1.
    const index = buildIndex(sales, { now: NOW, days: 6, rebalanceDays: 1 });
    const weights = Object.fromEntries(index.members.map((m) => [m.releaseId, m.weight]));
    expect(weights[1]).toBeCloseTo(0.75, 8); // $30 of $40 traded
    expect(weights[2]).toBeCloseTo(0.25, 8);
  });

  it('a pressing joining at a rebalance doesn’t move the level that day', () => {
    // A $100 pressing appears; the next weekly rebalance brings it in.
    const sales = [sale(1, 2000, 20), sale(2, 10_000, 10)];
    const index = buildIndex(sales, { now: NOW, days: 21, rebalanceDays: 7 });
    for (const point of index.series) expect(point.level).toBeCloseTo(INDEX_BASE, 8);
    expect(index.members.map((m) => m.releaseId).sort()).toEqual([1, 2]);
  });

  it('keeps only the biggest pressings', () => {
    const sales = [1, 2, 3, 4].map((id) => sale(id, id * 1000, 1));
    const index = buildIndex(sales, { now: NOW, days: 3, size: 2 });
    expect(index.members.map((m) => m.releaseId)).toEqual([4, 3]);
  });

  it('has nothing to say before any sale', () => {
    expect(buildIndex([], { now: NOW })).toEqual({
      series: [],
      members: [],
      divisor: null,
      rebalancedOn: null,
    });
  });

  it('moves only with prices: if every price doubles, the index doubles, whatever the membership', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            releaseId: fc.integer({ min: 1, max: 12 }),
            price: fc.integer({ min: 100, max: 50_000 }),
            daysAgo: fc.integer({ min: 10, max: 60 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (raw) => {
          const before = raw.map((s) => sale(s.releaseId, s.price, s.daysAgo));
          // Every pressing that traded sells once more today at exactly twice its last price.
          const last = new Map();
          for (const s of [...before].sort((a, b) => a.at - b.at))
            last.set(s.releaseId, s.priceCents);
          const after = [...last].map(([id, price]) => sale(id, price * 2, 0));
          const index = buildIndex([...before, ...after], {
            now: NOW,
            days: 61,
            rebalanceDays: 1000,
          });
          const yesterday = levelOn(index, 1);
          const today = levelOn(index, 0);
          expect(today / yesterday).toBeCloseTo(2, 6);
        },
      ),
      { numRuns: 300 },
    );
  });
});
