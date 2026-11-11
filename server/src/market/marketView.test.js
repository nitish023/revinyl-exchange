import { describe, expect, it } from 'vitest';
import { buildMarket } from './marketView.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(NOW - days * DAY);

let nextId = 1;
function ask(overrides = {}) {
  return {
    orderId: nextId++,
    priceCents: 4000,
    createdAt: daysAgo(1),
    copyId: nextId++,
    grade: 6,
    sleeveGrade: 6,
    flags: [],
    headline: '',
    notes: '',
    photos: 0,
    sellerName: 'groovegarden',
    sellerTrades: 3,
    ...overrides,
  };
}
function bid(overrides = {}) {
  return {
    orderId: nextId++,
    priceCents: 3000,
    minGrade: 6,
    note: '',
    createdAt: daysAgo(1),
    buyerTrades: 2,
    ...overrides,
  };
}
const sale = (grade, priceCents, days) => ({ grade, priceCents, createdAt: daysAgo(days) });

const build = (input) =>
  buildMarket({ releaseId: 249504, asks: [], bids: [], sales: [], now: NOW, ...input });

describe('FOR SALE ads', () => {
  it('groups ads by grade, best grade first', () => {
    const market = build({ asks: [ask({ grade: 5 }), ask({ grade: 7 }), ask({ grade: 6 })] });
    expect(market.forSale.map((group) => group.grade)).toEqual([7, 6, 5]);
  });

  it('puts the cheapest first inside a grade, then the earliest, then the lower id', () => {
    const early = ask({ priceCents: 4000, createdAt: daysAgo(3) });
    const late = ask({ priceCents: 4000, createdAt: daysAgo(1) });
    const cheap = ask({ priceCents: 3500, createdAt: daysAgo(0) });
    const sameTimeHighId = ask({ priceCents: 4000, createdAt: daysAgo(3), orderId: 9000 });
    const market = build({ asks: [late, sameTimeHighId, early, cheap] });
    expect(market.forSale[0].ads.map((ad) => ad.orderId)).toEqual([
      cheap.orderId,
      early.orderId,
      sameTimeHighId.orderId,
      late.orderId,
    ]);
  });

  it('sends prices as dollar strings and writes the condition like a record shop', () => {
    const market = build({ asks: [ask({ priceCents: 4250, grade: 6, sleeveGrade: null })] });
    const [ad] = market.forSale[0].ads;
    expect(ad.price).toBe('42.50');
    expect(ad.copy.condition).toBe('VG+, generic sleeve');
    expect(ad.seller).toEqual({ name: 'groovegarden', trades: 3 });
  });
});

describe('WANTED ads', () => {
  it('lists the highest offer first and never names the buyer', () => {
    const low = bid({ priceCents: 2000 });
    const high = bid({ priceCents: 4500, minGrade: 7 });
    const market = build({ bids: [low, high] });
    expect(market.wanted.map((ad) => ad.orderId)).toEqual([high.orderId, low.orderId]);
    expect(market.wanted[0].buyer).toEqual({ trades: 2 });
    expect(market.report.highestBid).toEqual({ price: '45.00', minGrade: 7 });
  });
});

describe('Market Report', () => {
  it('is empty for a pressing nobody has traded', () => {
    const { report, forSale, wanted } = build({});
    expect(forSale).toEqual([]);
    expect(wanted).toEqual([]);
    expect(report).toEqual({
      highestBid: null,
      lowestAsk: null,
      lastSale: null,
      byGrade: [],
      recentSales: [],
    });
  });

  it('shows the cheapest copy of any grade', () => {
    const market = build({
      asks: [ask({ priceCents: 5000, grade: 7 }), ask({ priceCents: 2600, grade: 5 })],
    });
    expect(market.report.lowestAsk).toEqual({ price: '26.00', grade: 5 });
  });

  it('reports each grade sold in the last 30 days: last price, change, low and high', () => {
    const sales = [
      sale(6, 4200, 1),
      sale(6, 3900, 5),
      sale(6, 3700, 20),
      sale(7, 4900, 3),
      sale(5, 2400, 45), // too old for the report
    ];
    const { byGrade, lastSale } = build({ sales }).report;
    expect(byGrade).toEqual([
      { grade: 7, last: '49.00', change: null, low: '49.00', high: '49.00', sales: 1 },
      { grade: 6, last: '42.00', change: '3.00', low: '37.00', high: '42.00', sales: 3 },
    ]);
    expect(lastSale).toEqual({ grade: 6, price: '42.00', soldAt: daysAgo(1).toISOString() });
  });

  it('compares with the previous sale even when it is older than 30 days', () => {
    const { byGrade } = build({ sales: [sale(6, 3500, 2), sale(6, 4000, 60)] }).report;
    expect(byGrade[0].change).toBe('-5.00');
  });

  it('lists the 8 most recent sales, newest first, whatever order they arrive in', () => {
    const sales = Array.from({ length: 10 }, (_, day) =>
      sale(6, 3000 + day * 100, day + 1),
    ).reverse();
    const { recentSales } = build({ sales }).report;
    expect(recentSales).toHaveLength(8);
    expect(recentSales[0].price).toBe('30.00');
    expect(recentSales[7].price).toBe('37.00');
  });
});
