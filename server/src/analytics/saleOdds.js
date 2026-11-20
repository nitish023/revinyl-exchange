/**
 * How likely a FOR SALE ad is to sell, and how fast, by how it's priced (Part 13).
 * Spec: docs/parts/part-13-fair-value.md. Tests: saleOdds.test.js. The formula that uses
 * the fit is chanceOfSale in shared/pricing.js.
 *
 * A survival model, the kind used for "time until an event". Every past ad is one
 * observation: how many days it was up, and whether it sold (the event) or was cancelled or
 * is still up (censored: we only know it hadn't sold yet). Ignoring censored ads would make
 * every price look like it sells, because only the ones that did would count.
 *
 * Each ad sells at a constant daily rate (an exponential model) that depends on its price
 * relative to fair value, x = ln(price / fair value):
 *     rate = exp(alpha + beta * x)
 * The log-likelihood of ad i (d = 1 if it sold, t = days up) is d*(alpha + beta*x) - rate*t.
 * It's concave in (alpha, beta), so Newton's method finds the maximum in a few steps. A
 * gentle normal prior on both keeps the fit sensible while there are only a few ads: a
 * fairly priced ad sells in about 10 days, and 10% over fair value cuts the rate by a third.
 */

/** The prior: mean and standard deviation of each parameter. */
export const PRIOR = Object.freeze({
  alpha: Math.log(1 / 10),
  beta: -4,
  alphaSd: 1.5,
  betaSd: 1.5,
});

/**
 * @typedef {object} AdOutcome
 * @property {number} x ln(price / fair value)
 * @property {number} days how long it was up (more than 0)
 * @property {boolean} sold
 */

/** The penalized log-likelihood, its gradient and its Hessian at (alpha, beta). */
function evaluate(ads, alpha, beta, prior) {
  let value = 0;
  let gA = 0;
  let gB = 0;
  let hAA = 0;
  let hAB = 0;
  let hBB = 0;
  for (const { x, days, sold } of ads) {
    const eta = alpha + beta * x;
    const expected = Math.exp(eta) * days; // expected sales in the time it was up
    const d = sold ? 1 : 0;
    value += d * eta - expected;
    gA += d - expected;
    gB += x * (d - expected);
    hAA -= expected;
    hAB -= x * expected;
    hBB -= x * x * expected;
  }
  const precisionA = 1 / prior.alphaSd ** 2;
  const precisionB = 1 / prior.betaSd ** 2;
  value -= ((alpha - prior.alpha) ** 2 * precisionA + (beta - prior.beta) ** 2 * precisionB) / 2;
  gA -= (alpha - prior.alpha) * precisionA;
  gB -= (beta - prior.beta) * precisionB;
  hAA -= precisionA;
  hBB -= precisionB;
  return { value, gA, gB, hAA, hAB, hBB };
}

/**
 * Fit (alpha, beta) by Newton's method, halving a step that doesn't improve the fit.
 * @param {AdOutcome[]} ads
 * @param {typeof PRIOR} [prior]
 * @returns {{ alpha: number, beta: number, ads: number, sold: number, iterations: number }}
 */
export function fitSaleOdds(ads, prior = PRIOR) {
  let alpha = prior.alpha;
  let beta = prior.beta;
  let current = evaluate(ads, alpha, beta, prior);
  let iterations = 0;
  for (; iterations < 100; iterations += 1) {
    const { gA, gB, hAA, hAB, hBB } = current;
    const det = hAA * hBB - hAB * hAB;
    // The Hessian is negative definite (concave + prior), so det > 0 and this is an ascent.
    const stepA = -(hBB * gA - hAB * gB) / det;
    const stepB = -(hAA * gB - hAB * gA) / det;
    let scale = 1;
    let next;
    for (let tries = 0; tries < 30; tries += 1) {
      next = evaluate(ads, alpha + scale * stepA, beta + scale * stepB, prior);
      if (next.value >= current.value) break;
      scale /= 2;
    }
    alpha += scale * stepA;
    beta += scale * stepB;
    const moved = Math.abs(scale * stepA) + Math.abs(scale * stepB);
    current = next;
    if (moved < 1e-10) break;
  }
  return {
    alpha,
    beta,
    ads: ads.length,
    sold: ads.filter((ad) => ad.sold).length,
    iterations,
  };
}
