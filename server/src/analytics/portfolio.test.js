import { describe, expect, it } from 'vitest';
import { buildPortfolio, portfolioSeries } from './portfolio.js';

describe('portfolioSeries (net worth over time)', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 10, 20, 12);
  const ago = (days) => NOW - days * DAY;
  const ME = 1;
  const OTHER = 2;
  const market = (sales, gradeStep = Math.log(1.25)) =>
    new Map([
      [
        9,
        { gradeStep, sales: sales.map(([days, cents]) => ({ at: ago(days), vgPlusCents: cents })) },
      ],
    ]);
  const at = (series, days) =>
    series.find((point) => point.day === new Date(ago(days)).toISOString().slice(0, 10));

  it('is your cash day by day when you own no records', () => {
    const series = portfolioSeries({
      userId: ME,
      now: NOW,
      days: 5,
      cash: [{ at: ago(10), amountCents: 200_000 }],
      copies: [],
      trades: [],
      markets: new Map(),
    });
    expect(series).toHaveLength(5);
    expect(series.every((point) => point.netWorthCents === 200_000)).toBe(true);
  });

  it('a copy you buy swaps cash for a record, then moves with its pressing’s price', () => {
    const series = portfolioSeries({
      userId: ME,
      now: NOW,
      days: 20,
      cash: [
        { at: ago(30), amountCents: 200_000 },
        { at: ago(10), amountCents: -4000 }, // paid for it ten days ago
      ],
      copies: [{ id: 5, ownerId: ME, releaseId: 9, grade: 7, createdAt: ago(40), removedAt: null }],
      trades: [{ copyId: 5, sellerId: OTHER, buyerId: ME, at: ago(10) }],
      // VG+ copies sold for $32 then, $40 three days ago: an NM is a quarter more.
      markets: market([
        [10, 3200],
        [3, 4000],
      ]),
    });
    expect(at(series, 12)).toMatchObject({ holdingsCents: 0, netWorthCents: 200_000 });
    expect(at(series, 10)).toMatchObject({ cashCents: 196_000, holdingsCents: 4000 });
    expect(at(series, 0)).toMatchObject({ holdingsCents: 5000, netWorthCents: 201_000 });
  });

  it('a copy you sell stops counting once it’s the buyer’s; a removed one once it’s gone', () => {
    const series = portfolioSeries({
      userId: ME,
      now: NOW,
      days: 10,
      cash: [{ at: ago(30), amountCents: 200_000 }],
      copies: [
        { id: 5, ownerId: OTHER, releaseId: 9, grade: 6, createdAt: ago(20), removedAt: null },
        { id: 6, ownerId: ME, releaseId: 9, grade: 6, createdAt: ago(20), removedAt: ago(2) },
      ],
      trades: [{ copyId: 5, sellerId: ME, buyerId: OTHER, at: ago(5) }],
      markets: market([[15, 3000]]),
    });
    expect(at(series, 6).holdingsCents).toBe(6000); // both
    expect(at(series, 4).holdingsCents).toBe(3000); // sold one
    expect(at(series, 1).holdingsCents).toBe(0); // removed the other
  });
});

const fair = new Map([
  ['1:6', 5000],
  ['1:7', 7000],
  ['2:6', 1200],
]);
const fairValue = (releaseId, grade) => fair.get(`${releaseId}:${grade}`) ?? null;
const holding = (copyId, releaseId, grade, costCents, status = 'in_crate') => ({
  copyId,
  releaseId,
  grade,
  status,
  costCents,
});

describe('buildPortfolio', () => {
  it('marks holdings to fair value and gains against what each copy cost', () => {
    const portfolio = buildPortfolio({
      cashCents: 150_000,
      fairValue,
      holdings: [holding(1, 1, 6, 4000), holding(2, 1, 7, null), holding(3, 2, 6, 1500)],
      sales: [],
    });
    expect(portfolio.holdings.map((h) => [h.fairCents, h.unrealizedCents])).toEqual([
      [5000, 1000],
      [7000, null], // added by hand: worth something, but no cost basis
      [1200, -300],
    ]);
    expect(portfolio.totals).toMatchObject({
      holdingsCents: 13_200,
      netWorthCents: 163_200,
      unrealizedCents: 700,
      investedCents: 5500,
    });
    expect(portfolio.totals.returnShare).toBeCloseTo(700 / 5500, 10);
  });

  it('realized gains are what a sale paid out, after the fee, less what that copy cost', () => {
    const portfolio = buildPortfolio({
      cashCents: 0,
      fairValue,
      holdings: [],
      sales: [
        { tradeId: 1, releaseId: 1, grade: 6, proceedsCents: 5280, costCents: 4000, heldDays: 12 },
        { tradeId: 2, releaseId: 2, grade: 6, proceedsCents: 880, costCents: null, heldDays: null },
      ],
    });
    expect(portfolio.realized.map((s) => s.gainCents)).toEqual([1280, null]);
    expect(portfolio.totals).toMatchObject({ realizedCents: 1280, investedCents: 4000 });
    expect(portfolio.totals.returnShare).toBeCloseTo(0.32, 10);
  });

  it('counts a copy without a fair value as unpriced, and has no return with nothing invested', () => {
    const portfolio = buildPortfolio({
      cashCents: 200_000,
      fairValue,
      holdings: [holding(9, 3, 5, null)],
      sales: [],
    });
    expect(portfolio.totals).toMatchObject({
      holdingsCents: 0,
      netWorthCents: 200_000,
      unpriced: 1,
      returnShare: null,
    });
  });
});
