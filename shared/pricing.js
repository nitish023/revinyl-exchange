/**
 * Pricing help for sellers (Part 13), shared by the browser (as you type a price) and the
 * server (which fits the numbers). Spec: docs/parts/part-13-fair-value.md.
 *
 * The chance an ad sells comes from a time-to-sale model fitted on every past FOR SALE ad
 * (server/src/analytics/saleOdds.js): each day an ad is up, it sells with a "hazard" rate
 * that falls as its price rises above fair value,
 *     hazard(price) = exp(alpha + beta * ln(price / fair value))   per day,
 * so the chance it has sold within `days` is 1 - exp(-hazard * days). beta is negative:
 * dearer ads wait longer.
 */
import { MAX_PRICE_CENTS, MIN_PRICE_CENTS } from './orders.js';

/**
 * @typedef {object} SaleOdds the fitted time-to-sale model
 * @property {number} alpha log of the daily sale rate of an ad at exactly fair value
 * @property {number} beta  how that rate changes with ln(price / fair value)
 */

/**
 * The chance an ad at `priceCents` sells within `days`, when fair value is `fairCents`.
 * @param {SaleOdds} odds
 * @param {number} priceCents
 * @param {number} fairCents
 * @param {number} days
 */
export function chanceOfSale(odds, priceCents, fairCents, days) {
  const hazard = Math.exp(odds.alpha + odds.beta * Math.log(priceCents / fairCents));
  return 1 - Math.exp(-hazard * days);
}

/** Prices to try, every 1% from half to twice fair value, kept inside the order limits. */
function candidatePrices(fairCents) {
  const prices = new Set();
  for (let percent = 50; percent <= 200; percent += 1) {
    const cents = Math.round((fairCents * percent) / 100);
    if (cents >= MIN_PRICE_CENTS && cents <= MAX_PRICE_CENTS) prices.add(cents);
  }
  return [...prices];
}

/** A quick sale needs at least this chance of selling within a week... */
const QUICK_CHANCE = 0.9;
/** ...and is always a discount on fair value, even in a market where everything sells. */
const QUICK_MAX_SHARE = 0.95;

/**
 * Three prices for a copy whose fair value is `fairCents`:
 *   quick    the highest price with at least a 90% chance of selling within a week, and at
 *            most 95% of fair value: a discount that sells
 *   fair     fair value itself
 *   patient  the price with the most expected money within 30 days (price x chance), which
 *            is usually above fair value: worth waiting for, if you can
 * Each with its chance of selling within a week and within 30 days.
 * @param {SaleOdds} odds
 * @param {number} fairCents
 */
export function suggestPrices(odds, fairCents) {
  const describe = (priceCents) => ({
    priceCents,
    week: chanceOfSale(odds, priceCents, fairCents, 7),
    month: chanceOfSale(odds, priceCents, fairCents, 30),
  });
  const prices = candidatePrices(fairCents);
  if (prices.length === 0) return null;
  const quick = prices
    .filter((cents) => cents <= fairCents * QUICK_MAX_SHARE)
    .filter((cents) => chanceOfSale(odds, cents, fairCents, 7) >= QUICK_CHANCE)
    .at(-1);
  let patient = prices[0];
  let best = -1;
  for (const cents of prices) {
    const expected = cents * chanceOfSale(odds, cents, fairCents, 30);
    if (expected > best) [best, patient] = [expected, cents];
  }
  const fair = Math.min(Math.max(fairCents, MIN_PRICE_CENTS), MAX_PRICE_CENTS);
  return {
    quick: describe(quick ?? prices[0]),
    fair: describe(fair),
    patient: describe(patient),
  };
}

/** "62%" for a chance, never 0% or 100%: the model is never that sure. */
export function chanceText(chance) {
  return `${Math.min(99, Math.max(1, Math.round(chance * 100)))}%`;
}

/** "a 62% chance" or "an 82% chance" (eight, eleven and eighteen start with a vowel sound). */
export function aChance(chance) {
  const text = chanceText(chance);
  return `${/^(8|11%|18%)/.test(text) ? 'an' : 'a'} ${text} chance`;
}
