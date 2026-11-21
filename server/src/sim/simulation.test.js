import { describe, expect, it } from 'vitest';
import { simulateMarket } from './simulation.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const average = (runs, pick) => runs.reduce((sum, run) => sum + pick(run.metrics), 0) / runs.length;

describe('simulateMarket', () => {
  it('gives the same market for the same seed', () => {
    expect(simulateMarket({ seed: 42 })).toEqual(simulateMarket({ seed: 42 }));
    expect(simulateMarket({ seed: 42 }).trades).not.toEqual(simulateMarket({ seed: 43 }).trades);
  });

  describe('a market maker, against the same traders without one (8 seeds)', () => {
    const without = SEEDS.map((seed) => simulateMarket({ seed, marketMaker: false }));
    const withMaker = SEEDS.map((seed) => simulateMarket({ seed, marketMaker: true }));

    it('narrows the spread', () => {
      expect(average(withMaker, (m) => m.meanSpread)).toBeLessThan(
        0.85 * average(without, (m) => m.meanSpread),
      );
    });

    it('means more trades and less waiting', () => {
      expect(average(withMaker, (m) => m.trades)).toBeGreaterThan(
        average(without, (m) => m.trades),
      );
      expect(average(withMaker, (m) => m.meanDaysToFill)).toBeLessThan(
        average(without, (m) => m.meanDaysToFill),
      );
    });

    it('keeps trade prices closer to what the record is really worth', () => {
      expect(average(withMaker, (m) => m.trackingError)).toBeLessThan(
        average(without, (m) => m.trackingError),
      );
    });

    it('earns its spread without piling up stock', () => {
      expect(average(withMaker, (m) => m.maker.profitCents)).toBeGreaterThan(0);
      for (const run of withMaker) expect(run.metrics.maker.maxStock).toBeLessThanOrEqual(6);
    });
  });
});
