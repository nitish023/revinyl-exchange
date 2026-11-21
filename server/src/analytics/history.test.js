import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OrderBook } from '../market/orderBook.js';
import { normal, seededRandom } from './stats.js';
import {
  dailyCandles,
  dayOf,
  depth,
  depthByGrade,
  priceStats,
  vgPlusEquivalent,
} from './history.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const sale = (daysAgo, priceCents, grade = 6, hour = 0) => ({
  grade,
  priceCents,
  at: NOW - daysAgo * DAY + hour * 3_600_000,
});

describe('vgPlusEquivalent', () => {
  it('restates a sale as if it were a VG+ copy', () => {
    const step = Math.log(1.25);
    expect(vgPlusEquivalent({ grade: 6, priceCents: 4000 }, step)).toBe(4000);
    expect(vgPlusEquivalent({ grade: 7, priceCents: 5000 }, step)).toBe(4000); // NM: one step up
    expect(vgPlusEquivalent({ grade: 4, priceCents: 2560 }, step)).toBe(4000); // G+: two down
  });
});

describe('dailyCandles', () => {
  it('opens, highs, lows and closes each day in order, in VG+ terms', () => {
    const candles = dailyCandles(
      [
        sale(2, 3000, 6, 3),
        sale(2, 3600, 6, 1),
        sale(2, 5000, 7, 2), // NM $50 = VG+ $40 at a 25% premium
        sale(0, 4200),
      ],
      Math.log(1.25),
    );
    expect(candles).toEqual([
      { day: dayOf(NOW - 2 * DAY), open: 3600, high: 4000, low: 3000, close: 3000, sales: 3 },
      { day: dayOf(NOW), open: 4200, high: 4200, low: 4200, close: 4200, sales: 1 },
    ]);
  });

  it('has nothing to show without sales', () => {
    expect(dailyCandles([], 0)).toEqual([]);
  });
});

describe('priceStats', () => {
  it('measures volatility on weekly levels, scaling gaps by the square root of their weeks', () => {
    // One sale a week: up 10%, down 10%, up 10%.
    const weekly = [sale(21, 4000), sale(14, 4400), sale(7, 4000), sale(0, 4400)];
    const r = Math.log(1.1);
    const sd = Math.sqrt((3 * r * r - (r * r) / 3) / 2); // sample sd of [r, -r, r]
    expect(priceStats(weekly, 0, NOW).monthlyVolatility).toBeCloseTo(sd * Math.sqrt(30 / 7), 10);
    // The same moves four weeks apart: each spread over 4 weeks, so half as volatile (√4 = 2).
    const slow = [sale(84, 4000), sale(56, 4400), sale(28, 4000), sale(0, 4400)];
    expect(priceStats(slow, 0, NOW).monthlyVolatility).toBeCloseTo(
      (sd / 2) * Math.sqrt(30 / 7),
      10,
    );
  });

  it('isn’t fooled by the scatter between individual copies', () => {
    // A level market: six sales a week for 20 weeks, each copy ±15% from the next.
    const random = seededRandom(3);
    const sales = [];
    for (let day = 0; day < 140; day += 1) {
      if (random() < 6 / 7)
        sales.push(sale(day, Math.round(4000 * Math.exp(0.15 * normal(random)))));
    }
    // Sale to sale this reads as over 100% a month (0.15 × √2 a day, × √30). A week's average
    // of ~6 copies keeps a sixth of the scatter's variance: about 0.18 a month, and no trend.
    expect(priceStats(sales, 0, NOW).monthlyVolatility).toBeLessThan(0.3);
  });

  it('says nothing about volatility from fewer than three weeks with sales', () => {
    expect(priceStats([sale(8, 4000), sale(0, 4400)], 0, NOW).monthlyVolatility).toBeNull();
  });

  it('the 30-day change compares weekly levels; the 52-week range is in VG+ terms', () => {
    const sales = [
      sale(400, 9000),
      sale(32, 2000),
      sale(31, 4500), // the week ending 30 days ago averages $30 (geometric mean)
      sale(10, 5000),
      sale(1, 3000),
      sale(0, 3630), // the last week averages $33
    ];
    const stats = priceStats(sales, 0, NOW);
    expect(stats.change30).toBeCloseTo(0.1, 2);
    expect(stats.high52).toBe(5000); // the $90 sale is over a year old
    expect(stats.low52).toBe(2000);
    expect(stats.lastClose).toBe(3630);
    // A Near Mint sale counts at its VG+ value.
    expect(
      priceStats([{ grade: 7, priceCents: 5000, at: NOW }], Math.log(1.25), NOW).lastClose,
    ).toBe(4000);
  });

  it('has no 30-day change without sales in both weeks', () => {
    expect(priceStats([sale(5, 4000), sale(0, 4400)], 0, NOW).change30).toBeNull();
  });
});

describe('depth', () => {
  it('stacks the book into staircases from the best price out, and measures the spread', () => {
    const { bids, asks, spread } = depth(
      [{ priceCents: 3000 }, { priceCents: 3500 }, { priceCents: 3000 }],
      [{ priceCents: 4000 }, { priceCents: 5000 }, { priceCents: 4000 }, { priceCents: 4500 }],
    );
    expect(bids).toEqual([
      { priceCents: 3500, copies: 1 },
      { priceCents: 3000, copies: 3 },
    ]);
    expect(asks).toEqual([
      { priceCents: 4000, copies: 2 },
      { priceCents: 4500, copies: 3 },
      { priceCents: 5000, copies: 4 },
    ]);
    expect(spread).toEqual({ bidCents: 3500, askCents: 4000, cents: 500, share: 0.125 });
  });

  it('has no spread with an empty side', () => {
    expect(depth([], [{ priceCents: 4000 }]).spread).toBeNull();
  });
});

describe('depthByGrade', () => {
  it('sets each grade’s copies against the wanted ads that would take that grade', () => {
    const books = depthByGrade(
      [
        { priceCents: 1700, minGrade: 6 }, // VG+ or better
        { priceCents: 900, minGrade: 1 }, // any grade
      ],
      [
        { priceCents: 700, grade: 4 }, // a G+ copy: only the "any grade" ad takes it
        { priceCents: 2500, grade: 7 },
      ],
    );
    expect(books[4].spread).toMatchObject({ bidCents: 900, askCents: 700 });
    expect(books[7].spread).toMatchObject({ bidCents: 1700, askCents: 2500, cents: 800 });
    expect(Object.keys(books).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('is never crossed for a book the engine built, whatever the order flow', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            side: fc.constantFrom('bid', 'ask'),
            userId: fc.integer({ min: 1, max: 4 }),
            dollars: fc.integer({ min: 1, max: 30 }),
            grade: fc.integer({ min: 1, max: 8 }),
          }),
          { maxLength: 50 },
        ),
        (flow) => {
          const book = new OrderBook(1);
          flow.forEach(({ side, userId, dollars, grade }, i) => {
            const order = { id: i + 1, userId, side, priceCents: dollars * 100, createdAt: i };
            const full =
              side === 'bid' ? { ...order, minGrade: grade } : { ...order, copyId: i + 1, grade };
            book.apply(full, book.match(full));
          });
          const books = depthByGrade(book.bids(), book.asks());
          for (const [grade, levels] of Object.entries(books)) {
            if (!levels.spread || levels.spread.cents > 0) continue;
            // Ads of different traders that meet would already have traded. Only one
            // trader's own wanted ad and copy can meet (nobody trades with themselves).
            const bidders = book
              .bids()
              .filter((b) => b.minGrade <= Number(grade) && b.priceCents >= levels.spread.askCents);
            const sellers = book
              .asks()
              .filter((a) => a.grade === Number(grade) && a.priceCents <= levels.spread.bidCents);
            const people = new Set([...bidders, ...sellers].map((o) => o.userId));
            expect(people.size).toBe(1);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
