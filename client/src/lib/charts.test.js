import { describe, expect, it } from 'vitest';
import {
  CANDLE_FRAME,
  candleLayout,
  depthLayout,
  historySummary,
  niceTicks,
  scale,
  shortDay,
  signedPercent,
} from './charts.js';

describe('niceTicks', () => {
  it.each([
    [0, 100, [0, 50, 100]],
    [1234, 5678, [2000, 4000]], // a range of ~4400 in four: steps of 1111 round up to 2000
    [3.2, 4.9, [3.5, 4, 4.5]],
  ])('%f to %f', (min, max, expected) => {
    expect(niceTicks(min, max, min === 0 ? 2 : 4)).toEqual(expected);
  });

  it('stays inside the range and steps evenly', () => {
    const ticks = niceTicks(1840, 5320);
    expect(ticks[0]).toBeGreaterThanOrEqual(1840);
    expect(ticks.at(-1)).toBeLessThanOrEqual(5320);
    const steps = new Set(ticks.slice(1).map((t, i) => t - ticks[i]));
    expect(steps.size).toBe(1);
  });
});

it('scale maps a domain onto a range, and a flat domain to the middle', () => {
  expect(scale(0, 10, 100, 200)(5)).toBe(150);
  expect(scale(5, 5, 100, 200)(5)).toBe(150);
});

describe('candleLayout', () => {
  const candles = [
    { day: '2026-11-01', open: '40.00', high: '45.00', low: '38.00', close: '44.00', sales: 2 },
    { day: '2026-11-05', open: '44.00', high: '44.00', low: '30.00', close: '31.00', sales: 4 },
    { day: '2026-11-06', open: '31.00', high: '31.00', low: '31.00', close: '31.00', sales: 1 },
  ];
  const { candles: laid, priceTicks } = candleLayout(candles);

  it('places days on a time axis, so a gap between sales is a gap on the chart', () => {
    const gap = (i) => laid[i + 1].x - laid[i].x;
    expect(gap(0)).toBeCloseTo(4 * gap(1), 6);
  });

  it('draws up days hollow and down days filled, with a visible body for a single sale', () => {
    expect(laid.map((c) => c.up)).toEqual([true, false, true]);
    expect(laid[2].bodyHeight).toBe(1.5);
    // Higher prices are higher on the chart: smaller y.
    expect(laid[0].wickTop).toBeLessThan(laid[0].bodyTop);
    expect(laid[1].bodyTop + laid[1].bodyHeight).toBeLessThanOrEqual(laid[1].wickBottom + 1e-9);
  });

  it('scales the sales bars to the busiest day and the price ticks to the range', () => {
    expect(laid[1].volumeTop).toBe(CANDLE_FRAME.volumeTop);
    expect(laid[2].volumeTop).toBeGreaterThan(laid[0].volumeTop);
    expect(priceTicks.length).toBeGreaterThan(1);
    for (const tick of priceTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(CANDLE_FRAME.top);
      expect(tick.y).toBeLessThanOrEqual(CANDLE_FRAME.priceBottom);
    }
  });
});

describe('depthLayout', () => {
  it('draws each side as a closed staircase from its best price outwards', () => {
    const layout = depthLayout({
      bids: [
        { price: '30.00', copies: 1 },
        { price: '25.00', copies: 3 },
      ],
      asks: [{ price: '40.00', copies: 2 }],
    });
    expect(layout.bidPath).toMatch(/^M[\d.]+,[\d.]+ V[\d.]+ H[\d.]+ V[\d.]+ H8\.0 V[\d.]+ Z$/);
    expect(layout.askPath).toMatch(/H712\.0 V[\d.]+ Z$/);
    expect(layout.maxCopies).toBe(3);
    expect(layout.x(3000)).toBeLessThan(layout.x(4000));
  });

  it('has nothing to draw for an empty book', () => {
    expect(depthLayout({ bids: [], asks: [] })).toBeNull();
  });
});

describe('words', () => {
  it('summarises the history in one line', () => {
    expect(
      historySummary({
        candles: [{}],
        stats: {
          lastClose: '31.00',
          change30: 0.124,
          monthlyVolatility: 0.183,
          low30: '31.00',
          high30: '38.00',
          low52: '30.00',
          high52: '45.00',
        },
      }),
    ).toBe(
      'Last sale $31.00 in VG+ terms · +12% over 30 days · volatility ±18% a month · ' +
        '30-day range $31.00 to $38.00 · 52-week range $30.00 to $45.00.',
    );
    expect(historySummary({ candles: [], stats: {} })).toBe('No sales yet, so no price history.');
  });

  it('dates and signed percents', () => {
    expect(shortDay('2026-11-05')).toBe('Nov 5');
    expect(signedPercent(-0.081)).toBe('−8%');
    expect(signedPercent(0)).toBe('+0%');
  });
});
