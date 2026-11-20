import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextReprice, repriceTarget } from './repricing.js';

const ask = (id, userId, priceCents, grade = 6, rule = null) => ({
  id,
  userId,
  side: 'ask',
  priceCents,
  grade,
  ...(rule && { stepCents: rule[0], limitCents: rule[1] }),
});
const bid = (id, userId, priceCents, minGrade = 6, rule = null) => ({
  id,
  userId,
  side: 'bid',
  priceCents,
  minGrade,
  ...(rule && { stepCents: rule[0], limitCents: rule[1] }),
});

describe('repriceTarget', () => {
  it('a FOR SALE ad drops a step under a cheaper copy of its grade, but not below its floor', () => {
    const mine = ask(1, 1, 5000, 6, [100, 3000]);
    expect(repriceTarget(mine, [mine, ask(2, 2, 4500)])).toBe(4400);
    expect(repriceTarget(mine, [mine, ask(2, 2, 2500)])).toBe(3000); // floor
  });

  it('ignores other grades, its own ads, and a market it already leads', () => {
    const mine = ask(1, 1, 5000, 6, [100, 3000]);
    expect(repriceTarget(mine, [mine, ask(2, 2, 4000, 7)])).toBeNull(); // a NM copy
    expect(repriceTarget(mine, [mine, ask(3, 1, 4000)])).toBeNull(); // my other copy
    expect(repriceTarget(mine, [mine, ask(2, 2, 6000)])).toBeNull(); // already cheapest
    expect(repriceTarget({ ...mine, priceCents: 3000 }, [mine, ask(2, 2, 2000)])).toBeNull(); // at its floor
  });

  it('a WANTED ad rises a step over a higher offer for its grade, up to its ceiling', () => {
    const mine = bid(1, 1, 2000, 6, [50, 3000]);
    expect(repriceTarget(mine, [mine, bid(2, 2, 2500)])).toBe(2550);
    expect(repriceTarget(mine, [mine, bid(2, 2, 2990)])).toBe(3000); // ceiling
    expect(repriceTarget(mine, [mine, bid(2, 2, 2500, 5)])).toBeNull(); // a different lowest grade
  });
});

describe('a price war between rules', () => {
  it('always ends, at the floors, after a bounded number of moves', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.integer({ min: 1000, max: 5000 }),
            floor: fc.integer({ min: 100, max: 1000 }),
            step: fc.integer({ min: 1, max: 300 }),
          }),
          { minLength: 2, maxLength: 5 },
        ),
        (sellers) => {
          let book = sellers.map((s, i) => ask(i + 1, i + 1, s.price, 6, [s.step, s.floor]));
          let moves = 0;
          for (;;) {
            const next = nextReprice(book, book);
            if (!next) break;
            moves += 1;
            expect(next.priceCents).toBeLessThan(next.order.priceCents); // always towards a sale
            expect(next.priceCents).toBeGreaterThanOrEqual(next.order.limitCents);
            // Cancel and replace: a new id, at the back of the queue.
            book = [
              ...book.filter((o) => o.id !== next.order.id),
              { ...next.order, id: 1000 + moves, priceCents: next.priceCents },
            ];
            expect(moves).toBeLessThan(5000 * sellers.length);
          }
          // At rest: nobody can undercut a rival any more without breaking their floor.
          for (const order of book) expect(repriceTarget(order, book)).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('skips an order that couldn’t move this turn', () => {
    const rules = [ask(1, 1, 5000, 6, [100, 100]), ask(2, 2, 5000, 6, [100, 100])];
    const resting = [...rules, ask(3, 3, 4000)];
    expect(nextReprice(rules, resting).order.id).toBe(1);
    expect(nextReprice(rules, resting, new Set([1])).order.id).toBe(2);
  });
});
