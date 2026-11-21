import { describe, expect, it } from 'vitest';
import { reversionOrders } from './meanReversion.js';
import { simulateMarket } from './simulation.js';

describe('reversionOrders', () => {
  const market = { fairCents: 4000, sigma: 0.1 };

  it('buys a dip: a sale well under fair value gets a bid just above it', () => {
    // $34 is ln(34/40)/0.1 = −1.6 standard deviations under fair.
    expect(reversionOrders({ ...market, lastCents: 3400, stock: 0 })).toMatchObject({
      bidCents: 3468,
      askCents: null,
    });
    expect(reversionOrders({ ...market, lastCents: 3400, stock: 3 }).bidCents).toBeNull(); // full
  });

  it('sells a spike, but never below fair value, and only what it holds', () => {
    expect(reversionOrders({ ...market, lastCents: 4800, stock: 1 })).toMatchObject({
      bidCents: null,
      askCents: 4704,
    });
    expect(reversionOrders({ ...market, lastCents: 4800, stock: 0 }).askCents).toBeNull();
  });

  it('once prices are back to normal, offers what it holds at fair value', () => {
    expect(reversionOrders({ ...market, lastCents: 4100, stock: 2 })).toMatchObject({
      bidCents: null,
      askCents: 4000,
    });
    expect(reversionOrders({ ...market, lastCents: 4100, stock: 0 })).toMatchObject({
      bidCents: null,
      askCents: null,
    });
  });
});

describe('a mean-reversion trader in the simulation (20 seeds)', () => {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const average = (options, pick) =>
    seeds.reduce((sum, seed) => sum + pick(simulateMarket({ seed, ...options }).metrics), 0) /
    seeds.length;

  it('makes money where there’s no market maker, buying dips and selling them back', () => {
    expect(
      average({ marketMaker: false, meanReverter: true }, (m) => m.reverter.profitCents),
    ).toBeGreaterThan(0);
    expect(
      average({ marketMaker: false, meanReverter: true }, (m) => m.reverter.maxStock),
    ).toBeLessThanOrEqual(3);
  });

  it('earns less once a market maker keeps prices near value: the dips it waits for are rarer', () => {
    expect(average({ meanReverter: true }, (m) => m.reverter.profitCents)).toBeLessThan(
      average({ marketMaker: false, meanReverter: true }, (m) => m.reverter.profitCents),
    );
  });
});
