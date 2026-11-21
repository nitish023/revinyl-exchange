/**
 * Fair value per grade (Part 13): what a copy of a pressing is worth in each grade, with a
 * range, from its sales. Spec: docs/parts/part-13-fair-value.md. Tests: fairValue.test.js.
 *
 * StockX shows the last sale. One sale says little, and most grades of most pressings have
 * none, so instead every sale of the pressing informs every grade through one model:
 *
 *     ln(price) = a + b * (grade - VG+)
 *
 * b is the grade premium: each grade up multiplies the price by e^b. Fitted by weighted
 * least squares where
 *   - recent sales count more: a sale's weight halves every 30 days;
 *   - b is pulled towards the premium seen across the whole market (`priorStep`), as if we'd
 *     seen PRIOR_STRENGTH extra sales that agreed with it, so one or two sales of a single
 *     grade still give sensible prices for the other grades (empirical Bayes shrinkage);
 *   - b is never negative: a better copy is never worth less;
 *   - outliers are dropped: after a first fit, a sale whose residual is more than 3.5
 *     robust standard deviations (MADs) from the median residual is set aside and the model
 *     refitted, so one silly or suspicious price can't drag fair value around.
 * Each estimate comes with an 80% prediction interval: the spread of the sales around the
 * line plus how unsure the line itself is (which grows away from the grades actually sold).
 */
import { median } from './stats.js';

/** The grade the model is centred on (VG+, rank 6): `a` is VG+'s log price. */
const CENTER_GRADE = 6;
export const HALF_LIFE_DAYS = 30;
/** Each grade step adds ~30% when the market hasn't told us otherwise. */
export const DEFAULT_GRADE_STEP = Math.log(1.3);
/** How many sales' worth of belief the prior grade premium carries. */
const PRIOR_STRENGTH = 2;
/** The log-price spread we assume before seeing data (~30%), and how strongly. */
const PRIOR_SIGMA = 0.3;
const PRIOR_DEGREES = 2;
/** A sale this many robust standard deviations from the rest is an outlier... */
const OUTLIER_MADS = 3.5;
/** ...measured with at least this spread, so near-identical prices don't flag a 5% move. */
const MIN_SPREAD = 0.05;
/** Only look for outliers with at least this many sales: fewer can't say what's typical. */
const MIN_SALES_FOR_OUTLIERS = 4;
/** z for an 80% two-sided interval. */
const Z80 = 1.2816;
const DAY_MS = 86_400_000;

/**
 * @typedef {object} Sale
 * @property {number} [id] the trade id, to report outliers
 * @property {number} grade 1 (Poor) to 8 (Mint)
 * @property {number} priceCents
 * @property {number} at milliseconds since 1970
 */

/**
 * Weighted least squares for ln(price) = a + b·x with a ridge pull of b towards `priorStep`,
 * and b >= 0. Returns the coefficients and the inverse of the normal matrix (for intervals).
 */
function solve(points, priorStep) {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let t0 = 0;
  let t1 = 0;
  for (const { x, y, w } of points) {
    s0 += w;
    s1 += w * x;
    s2 += w * x * x;
    t0 += w * y;
    t1 += w * x * y;
  }
  const m11 = s2 + PRIOR_STRENGTH;
  const det = s0 * m11 - s1 * s1;
  let a = (t0 * m11 - s1 * (t1 + PRIOR_STRENGTH * priorStep)) / det;
  let b = (s0 * (t1 + PRIOR_STRENGTH * priorStep) - s1 * t0) / det;
  if (b < 0) {
    // A better grade is never worth less: fit the level alone with no premium.
    b = 0;
    a = t0 / s0;
  }
  return { a, b, inverse: [m11 / det, -s1 / det, s0 / det], weight: s0 };
}

/**
 * Fit a pressing's fair value from its sales.
 * @param {Sale[]} sales
 * @param {{ now?: number, priorStep?: number, halfLifeDays?: number }} [options]
 * @returns {null | {
 *   grades: { grade: number, fairCents: number, lowCents: number, highCents: number, sales: number }[],
 *   gradeStep: number, salesUsed: number, outliers: Sale[], sigma: number }}
 *   null when there are no sales
 */
export function fitFairValue(
  sales,
  { now = Date.now(), priorStep = DEFAULT_GRADE_STEP, halfLifeDays = HALF_LIFE_DAYS } = {},
) {
  if (sales.length === 0) return null;
  const all = sales.map((sale) => ({
    sale,
    x: sale.grade - CENTER_GRADE,
    y: Math.log(sale.priceCents),
    w: 0.5 ** (Math.max(0, now - sale.at) / DAY_MS / halfLifeDays),
  }));

  let points = all;
  let fit = solve(points, priorStep);
  let outliers = [];
  if (all.length >= MIN_SALES_FOR_OUTLIERS) {
    const residuals = all.map((p) => p.y - (fit.a + fit.b * p.x));
    const centre = median(residuals);
    const spread = Math.max(
      median(residuals.map((r) => Math.abs(r - centre))) * 1.4826,
      MIN_SPREAD,
    );
    const keep = residuals.map((r) => Math.abs(r - centre) <= OUTLIER_MADS * spread);
    outliers = all.filter((_, i) => !keep[i]).map((p) => p.sale);
    if (outliers.length > 0) {
      points = all.filter((_, i) => keep[i]);
      fit = solve(points, priorStep);
    }
  }

  // Spread around the line, blended with the prior spread while there's little data.
  let squared = 0;
  for (const { x, y, w } of points) squared += w * (y - fit.a - fit.b * x) ** 2;
  const variance =
    (PRIOR_DEGREES * PRIOR_SIGMA ** 2 + squared) / (PRIOR_DEGREES + Math.max(fit.weight - 1, 0));
  const [i00, i01, i11] = fit.inverse;

  const grades = [];
  for (let grade = 1; grade <= 8; grade += 1) {
    const x = grade - CENTER_GRADE;
    const centre = fit.a + fit.b * x;
    // Variance of a new sale at this grade: the scatter, plus the line's own uncertainty.
    const spread = Math.sqrt(variance * (1 + i00 + 2 * x * i01 + x * x * i11));
    grades.push({
      grade,
      fairCents: Math.round(Math.exp(centre)),
      lowCents: Math.round(Math.exp(centre - Z80 * spread)),
      highCents: Math.round(Math.exp(centre + Z80 * spread)),
      sales: points.filter((p) => p.sale.grade === grade).length,
    });
  }
  return {
    grades,
    gradeStep: fit.b,
    salesUsed: points.length,
    outliers,
    sigma: Math.sqrt(variance),
  };
}

/**
 * The grade premium across the whole market, for pressings whose own sales can't say:
 * within each pressing, how log price moves with grade (each pressing's own price level
 * removed, so a $5 single and a $500 first pressing can be pooled), shrunk towards the
 * default while there's little evidence. Clamped to [0, ln 2]: up to doubling per grade.
 * @param {Map<number, Sale[]>} salesByRelease
 */
export function pooledGradeStep(salesByRelease) {
  let sxx = 0;
  let sxy = 0;
  for (const sales of salesByRelease.values()) {
    if (sales.length < 2) continue;
    const meanX = sales.reduce((sum, s) => sum + s.grade, 0) / sales.length;
    const meanY = sales.reduce((sum, s) => sum + Math.log(s.priceCents), 0) / sales.length;
    for (const sale of sales) {
      sxx += (sale.grade - meanX) ** 2;
      sxy += (sale.grade - meanX) * (Math.log(sale.priceCents) - meanY);
    }
  }
  // Like PRIOR_STRENGTH: 4 units of grade spread's worth of belief in the default.
  const step = (sxy + 4 * DEFAULT_GRADE_STEP) / (sxx + 4);
  return Math.min(Math.max(step, 0), Math.log(2));
}
