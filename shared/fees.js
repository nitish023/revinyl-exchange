/**
 * Seller fees, seller levels and reliability (Part 12), shared by the browser (the payout a
 * seller will get, before they list) and the server (the fee fixed on the trade). Spec:
 * docs/parts/part-12-fees.md.
 *
 * Like StockX: a seller pays a transaction fee that falls as they sell more (their level,
 * from the last 90 days), plus a flat payment processing fee. The buyer pays exactly the
 * price. The fee is fixed when the trade is made and taken out of the payout when the buyer
 * accepts the record; a refunded trade costs the seller nothing.
 */

/** Payment processing: 3% of the price, for every seller. In basis points (1/100 of 1%). */
export const PROCESSING_FEE_BPS = 300;

/** The window a seller's level is measured over. */
export const LEVEL_WINDOW_DAYS = 90;

/**
 * The levels, lowest first. A seller is at the highest level whose every threshold they
 * meet: completed sales and their total value in the last 90 days, and (for the top two
 * levels) a reliability score, so a seller can't buy their way up while letting buyers down.
 */
export const SELLER_LEVELS = Object.freeze([
  { level: 1, transactionFeeBps: 900, minSales: 0, minVolumeCents: 0, minReliability: 0 },
  { level: 2, transactionFeeBps: 850, minSales: 3, minVolumeCents: 10_000, minReliability: 0 },
  { level: 3, transactionFeeBps: 800, minSales: 10, minVolumeCents: 50_000, minReliability: 0 },
  { level: 4, transactionFeeBps: 750, minSales: 25, minVolumeCents: 150_000, minReliability: 0.8 },
  { level: 5, transactionFeeBps: 700, minSales: 50, minVolumeCents: 400_000, minReliability: 0.9 },
]);

/**
 * a / b rounded to the nearest whole number, with an exact half going to the even
 * neighbour ("banker's rounding"). Rounding halves up every time would overcharge sellers a
 * fraction of a cent on average; half-to-even comes out even over many sales. Exact
 * integer arithmetic: no floating-point cents.
 * @param {number} a a whole number, 0 or more
 * @param {number} b a whole number, more than 0
 */
export function roundHalfEven(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b <= 0) {
    throw new RangeError(`roundHalfEven needs whole numbers a >= 0 and b > 0 (got ${a}, ${b})`);
  }
  const quotient = Math.floor(a / b);
  const twiceRemainder = 2 * (a - quotient * b);
  if (twiceRemainder > b) return quotient + 1;
  if (twiceRemainder < b) return quotient;
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

/** The share of `cents` that `bps` basis points is, in whole cents. */
export const basisPoints = (cents, bps) => roundHalfEven(cents * bps, 10_000);

/**
 * What a sale at this price costs a seller at this level, and what they're paid.
 * @param {number} priceCents
 * @param {number} level 1 to 5
 * @returns {{ transactionFeeCents: number, processingFeeCents: number, feeCents: number,
 *   payoutCents: number, feeBps: number }}
 */
export function payoutFor(priceCents, level) {
  const tier = SELLER_LEVELS.find((candidate) => candidate.level === level);
  if (!tier) throw new RangeError(`There is no seller level ${level}`);
  const transactionFeeCents = basisPoints(priceCents, tier.transactionFeeBps);
  const processingFeeCents = basisPoints(priceCents, PROCESSING_FEE_BPS);
  const feeCents = transactionFeeCents + processingFeeCents;
  return {
    transactionFeeCents,
    processingFeeCents,
    feeCents,
    payoutCents: priceCents - feeCents,
    feeBps: tier.transactionFeeBps + PROCESSING_FEE_BPS,
  };
}

/**
 * The Wilson score interval's lower bound: how reliable a seller is, at least, with 95%
 * confidence, from `successes` out of `total`. Unlike a plain percentage it doesn't trust a
 * seller with 1 sale out of 1 more than one with 98 out of 100: a small record gives a wide
 * interval and a low bound. 0 for no record at all.
 * @param {number} successes
 * @param {number} total
 * @param {number} [z] 1.96 for 95% confidence
 */
export function wilsonLowerBound(successes, total, z = 1.96) {
  if (total === 0) return 0;
  const p = successes / total;
  const z2 = z * z;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / (1 + z2 / total));
}

/**
 * A seller's reliability: completed sales against sales that ended in a refund (cancelled
 * before shipping, or sent back as not described).
 * @param {{ completed: number, refunded: number }} record all-time, as the seller
 */
export const reliabilityOf = ({ completed, refunded }) =>
  wilsonLowerBound(completed, completed + refunded);

/**
 * @typedef {object} SellerRecord
 * @property {number} sales90 completed sales in the last 90 days
 * @property {number} volume90Cents their total price
 * @property {number} completed all-time completed sales
 * @property {number} refunded all-time refunded sales
 */

/**
 * A seller's level, fee and what the next level needs.
 * @param {SellerRecord} record
 */
export function standingOf(record) {
  const reliability = reliabilityOf(record);
  const meets = (tier) =>
    record.sales90 >= tier.minSales &&
    record.volume90Cents >= tier.minVolumeCents &&
    reliability >= tier.minReliability;
  const tier = SELLER_LEVELS.findLast(meets);
  const next = SELLER_LEVELS.find((candidate) => candidate.level === tier.level + 1) ?? null;
  return {
    level: tier.level,
    transactionFeeBps: tier.transactionFeeBps,
    feeBps: tier.transactionFeeBps + PROCESSING_FEE_BPS,
    reliability,
    next: next && {
      level: next.level,
      salesNeeded: Math.max(0, next.minSales - record.sales90),
      volumeNeededCents: Math.max(0, next.minVolumeCents - record.volume90Cents),
      reliabilityNeeded: reliability >= next.minReliability ? 0 : next.minReliability,
    },
  };
}

/** "12%" or "11.5%": a fee in basis points as people say it. */
export const percentText = (bps) => `${Number((bps / 100).toFixed(2))}%`;

/**
 * How a seller's record reads on their ad: "New seller" until three settled sales (too few
 * to say anything), then the plain share that went through, e.g. "98% of sales completed".
 * Buyers read a plain rate best; the Wilson score (reliabilityOf), which is cautious about
 * short records, is what decides levels, and the Listening Room explains it to the seller.
 */
export function reliabilityText({ completed, refunded }) {
  const settled = completed + refunded;
  if (settled < 3) return 'New seller';
  return `${Math.floor((completed / settled) * 100)}% of sales completed`;
}

/**
 * The Wilson score as a trust score out of 100, with what it means, for the seller.
 * @param {{ completed: number, refunded: number }} record
 */
export function trustScoreText({ completed, refunded }) {
  const score = Math.round(reliabilityOf({ completed, refunded }) * 100);
  return (
    `Trust score ${score} out of 100: from ${completed} completed and ${refunded} refunded ` +
    `${completed + refunded === 1 ? 'sale' : 'sales'}, we’re 95% sure at least ${score}% of your ` +
    'sales go through. It rises as your record grows.'
  );
}
