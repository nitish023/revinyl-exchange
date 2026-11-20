import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADE_STEP, fitFairValue, pooledGradeStep } from './fairValue.js';
import { normal, seededRandom } from './stats.js';

const NOW = Date.UTC(2026, 10, 20);
const DAY = 86_400_000;
const VG_PLUS = 6;
const at = (grade, fair) => fair.grades.find((row) => row.grade === grade);

/** Sales drawn from ln(price) = ln(level) + step*(grade - 6) + noise, spread over `days`. */
function simulate({ count, level, step, noise, seed, days = 60, grades = [3, 4, 5, 6, 7, 8] }) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, id) => {
    const grade = grades[Math.floor(random() * grades.length)];
    const price = Math.exp(Math.log(level) + step * (grade - VG_PLUS) + noise * normal(random));
    return {
      id,
      grade,
      priceCents: Math.max(100, Math.round(price)),
      at: NOW - random() * days * DAY,
    };
  });
}

describe('fitFairValue', () => {
  it('has nothing to say about a pressing that has never sold', () => {
    expect(fitFairValue([], { now: NOW })).toBeNull();
  });

  it('recovers the price level and the grade premium from enough sales', () => {
    const sales = simulate({ count: 120, level: 4000, step: 0.25, noise: 0.1, seed: 1 });
    const fair = fitFairValue(sales, { now: NOW });
    expect(fair.gradeStep).toBeGreaterThan(0.2);
    expect(fair.gradeStep).toBeLessThan(0.3);
    expect(at(VG_PLUS, fair).fairCents).toBeGreaterThan(3600);
    expect(at(VG_PLUS, fair).fairCents).toBeLessThan(4400);
    // Clean normal noise: at most the odd 3.5-sigma draw is set aside (here one, at -3.4).
    expect(fair.outliers.length).toBeLessThanOrEqual(2);
  });

  it('its 80% ranges hold about 80% of new sales', () => {
    const fair = fitFairValue(
      simulate({ count: 80, level: 2500, step: 0.2, noise: 0.15, seed: 2 }),
      {
        now: NOW,
      },
    );
    const fresh = simulate({ count: 4000, level: 2500, step: 0.2, noise: 0.15, seed: 3, days: 0 });
    const inside = fresh.filter((sale) => {
      const row = at(sale.grade, fair);
      return sale.priceCents >= row.lowCents && sale.priceCents <= row.highCents;
    }).length;
    expect(inside / fresh.length).toBeGreaterThan(0.72);
    expect(inside / fresh.length).toBeLessThan(0.9);
  });

  it('from one sale, prices every grade with the market’s premium, and is less sure further away', () => {
    const fair = fitFairValue([{ grade: VG_PLUS, priceCents: 3000, at: NOW }], {
      now: NOW,
      priorStep: Math.log(1.3),
    });
    expect(at(VG_PLUS, fair).fairCents).toBe(3000);
    expect(at(7, fair).fairCents).toBe(3900); // +30%
    const width = (grade) => at(grade, fair).highCents / at(grade, fair).lowCents;
    expect(width(VG_PLUS)).toBeLessThan(width(8));
    expect(width(8)).toBeLessThan(width(1) * 1.0001);
    expect(at(VG_PLUS, fair).sales).toBe(1);
    expect(at(7, fair).sales).toBe(0);
  });

  it('sets aside a wild sale instead of letting it drag fair value', () => {
    const sales = [
      ...[3900, 4000, 4100, 3950, 4050, 4000, 3980, 4020].map((priceCents, id) => ({
        id,
        grade: VG_PLUS,
        priceCents,
        at: NOW - id * DAY,
      })),
      { id: 99, grade: VG_PLUS, priceCents: 40_000, at: NOW },
    ];
    const fair = fitFairValue(sales, { now: NOW });
    expect(fair.outliers.map((sale) => sale.id)).toEqual([99]);
    expect(fair.salesUsed).toBe(8);
    expect(at(VG_PLUS, fair).fairCents).toBeGreaterThan(3950);
    expect(at(VG_PLUS, fair).fairCents).toBeLessThan(4050);
  });

  it('listens to recent sales more than old ones (30-day half-life)', () => {
    const sales = [
      ...[0, 1, 2].map((i) => ({ grade: VG_PLUS, priceCents: 2000, at: NOW - (120 + i) * DAY })),
      ...[0, 1, 2].map((i) => ({ grade: VG_PLUS, priceCents: 4000, at: NOW - i * DAY })),
    ];
    const fair = at(VG_PLUS, fitFairValue(sales, { now: NOW })).fairCents;
    expect(fair).toBeGreaterThan(3700); // a plain average would say about $28
  });

  it('never prices a better grade below a worse one, whatever the sales', () => {
    const sale = fc.record({
      grade: fc.integer({ min: 1, max: 8 }),
      priceCents: fc.integer({ min: 100, max: 1_000_000 }),
      ageDays: fc.integer({ min: 0, max: 365 }),
    });
    fc.assert(
      fc.property(fc.array(sale, { minLength: 1, maxLength: 30 }), (raw) => {
        const fair = fitFairValue(
          raw.map((s) => ({ ...s, at: NOW - s.ageDays * DAY })),
          { now: NOW },
        );
        for (let i = 1; i < fair.grades.length; i += 1) {
          expect(fair.grades[i].fairCents).toBeGreaterThanOrEqual(fair.grades[i - 1].fairCents);
        }
        for (const row of fair.grades) {
          expect(row.lowCents).toBeLessThanOrEqual(row.fairCents);
          expect(row.highCents).toBeGreaterThanOrEqual(row.fairCents);
        }
      }),
    );
  });
});

describe('pooledGradeStep', () => {
  it('learns the premium across pressings with very different price levels', () => {
    const byRelease = new Map(
      [500, 4000, 30_000].map((level, i) => [
        i,
        simulate({ count: 40, level, step: 0.35, noise: 0.1, seed: 10 + i }),
      ]),
    );
    const step = pooledGradeStep(byRelease);
    expect(step).toBeGreaterThan(0.3);
    expect(step).toBeLessThan(0.4);
  });

  it('stays at the default with nothing to learn from', () => {
    expect(pooledGradeStep(new Map())).toBeCloseTo(DEFAULT_GRADE_STEP, 10);
    expect(pooledGradeStep(new Map([[1, [{ grade: 6, priceCents: 100, at: NOW }]]]))).toBeCloseTo(
      DEFAULT_GRADE_STEP,
      10,
    );
  });
});
