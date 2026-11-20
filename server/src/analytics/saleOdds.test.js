import { describe, expect, it } from 'vitest';
import { aChance, chanceOfSale, chanceText, suggestPrices } from '../../../shared/pricing.js';
import { fitSaleOdds, PRIOR } from './saleOdds.js';
import { seededRandom } from './stats.js';

/**
 * Ads priced around fair value, selling at rate exp(alpha + beta*x) per day, each taken
 * down (censored) after a random 5 to 40 days if it hasn't sold.
 */
function simulate({ count, alpha, beta, seed }) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const x = -0.3 + random() * 0.7;
    const rate = Math.exp(alpha + beta * x);
    const saleDay = -Math.log(1 - random()) / rate;
    const takenDown = 5 + random() * 35;
    return saleDay <= takenDown
      ? { x, days: saleDay, sold: true }
      : { x, days: takenDown, sold: false };
  });
}

const vague = { ...PRIOR, alphaSd: 100, betaSd: 100 };

describe('fitSaleOdds', () => {
  it('recovers how fast ads sell and how price slows them, from censored data', () => {
    const fit = fitSaleOdds(simulate({ count: 4000, alpha: -2, beta: -5, seed: 7 }), vague);
    expect(fit.alpha).toBeCloseTo(-2, 1);
    expect(fit.beta).toBeGreaterThan(-5.6);
    expect(fit.beta).toBeLessThan(-4.4);
    expect(fit.iterations).toBeLessThan(20);
  });

  it('would be fooled by dropping the ads that didn’t sell: censoring matters', () => {
    const ads = simulate({ count: 4000, alpha: -2.5, beta: -5, seed: 8 });
    const honest = fitSaleOdds(ads, vague);
    const soldOnly = fitSaleOdds(
      ads.filter((ad) => ad.sold),
      vague,
    );
    // Counting only the winners makes ads look like they sell much faster than they do.
    expect(soldOnly.alpha).toBeGreaterThan(honest.alpha + 0.5);
  });

  it('falls back to the prior with no ads at all', () => {
    const fit = fitSaleOdds([]);
    expect(fit.alpha).toBeCloseTo(PRIOR.alpha, 8);
    expect(fit.beta).toBeCloseTo(PRIOR.beta, 8);
  });
});

describe('chanceOfSale and suggestPrices', () => {
  const odds = { alpha: Math.log(1 / 10), beta: -4 };

  it('a dearer ad is less likely to sell, and any ad more likely given longer', () => {
    expect(chanceOfSale(odds, 4400, 4000, 7)).toBeLessThan(chanceOfSale(odds, 4000, 4000, 7));
    expect(chanceOfSale(odds, 4000, 4000, 30)).toBeGreaterThan(chanceOfSale(odds, 4000, 4000, 7));
    // At fair value the rate is 1/10 a day: 1 - e^(-0.7) within a week.
    expect(chanceOfSale(odds, 4000, 4000, 7)).toBeCloseTo(1 - Math.exp(-0.7), 10);
  });

  it('suggests a quick price under fair value, and a patient one worth waiting for', () => {
    const { quick, fair, patient } = suggestPrices(odds, 4000);
    expect(quick.priceCents).toBeLessThan(fair.priceCents);
    expect(quick.week).toBeGreaterThanOrEqual(0.9);
    expect(quick.priceCents).toBeLessThanOrEqual(3800); // at most 95% of fair: always a discount
    expect(fair.priceCents).toBe(4000);
    // Patient: the most expected money within 30 days, so no other price beats it.
    const expected = (cents) => cents * chanceOfSale(odds, cents, 4000, 30);
    for (const cents of [3000, 3600, 4000, 4400, 5000]) {
      expect(expected(patient.priceCents)).toBeGreaterThanOrEqual(expected(cents));
    }
  });

  it('keeps suggestions inside the order limits', () => {
    const { quick } = suggestPrices(odds, 150);
    expect(quick.priceCents).toBeGreaterThanOrEqual(100);
  });

  it('a hot market still gets a discounted quick sale', () => {
    // Everything sells fast here: even fair value has a 99% chance within a week.
    const hot = { alpha: Math.log(2), beta: -4 };
    const { quick, fair } = suggestPrices(hot, 4000);
    expect(quick.priceCents).toBe(3800);
    expect(fair.week).toBeGreaterThan(0.99);
  });

  it('says "a" or "an" before a chance', () => {
    expect(aChance(0.62)).toBe('a 62% chance');
    expect(aChance(0.82)).toBe('an 82% chance');
    expect(aChance(0.11)).toBe('an 11% chance');
    expect(aChance(0.18)).toBe('an 18% chance');
    expect(aChance(0.08)).toBe('an 8% chance');
    expect(aChance(0.81)).toBe('an 81% chance');
    expect(aChance(0.01)).toBe('a 1% chance');
  });

  it('writes chances as whole percents, never 0% or 100%', () => {
    expect(chanceText(0.623)).toBe('62%');
    expect(chanceText(0.0001)).toBe('1%');
    expect(chanceText(0.9999)).toBe('99%');
  });
});
