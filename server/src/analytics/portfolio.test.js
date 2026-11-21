import { describe, expect, it } from 'vitest';
import { buildPortfolio } from './portfolio.js';

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
