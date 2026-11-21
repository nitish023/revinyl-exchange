/**
 * Price history and depth for a pressing (Part 14). Spec: docs/parts/part-14-history.md.
 * Tests: history.test.js. Pure: pricingService.js reads the data and calls these.
 *
 * Sales of different grades can't share a chart as they are: a Mint copy selling for $60
 * after a VG one for $20 isn't the price tripling. So every sale is first restated as its
 * VG+ equivalent, price × e^(-b·(grade − VG+)), with b the pressing's fitted grade premium
 * (fairValue.js). Then, as for a stock:
 *   - daily candles (UTC days): open, high, low and close of the day's sales, and how many;
 *   - volatility: the standard deviation of the log change between one trading day's close
 *     and the next, each scaled by √(days between) so gaps don't count as calm, and stated
 *     for a month (× √30);
 *   - the change over 30 days, and the 52-week high and low.
 * Depth is the order book as two staircases: how many copies are wanted at a price or more,
 * and how many are for sale at a price or less.
 */

const DAY_MS = 86_400_000;
const CENTER_GRADE = 6;

/** "2026-11-20" for the UTC day a time falls on. */
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * A sale's price as if it were a VG+ copy.
 * @param {{ grade: number, priceCents: number }} sale
 * @param {number} gradeStep b, the log price change per grade
 */
export const vgPlusEquivalent = (sale, gradeStep) =>
  Math.round(sale.priceCents * Math.exp(-gradeStep * (sale.grade - CENTER_GRADE)));

/**
 * @typedef {object} Candle
 * @property {string} day "2026-11-20"
 * @property {number} open  VG+-equivalent cents of the day's first sale
 * @property {number} high
 * @property {number} low
 * @property {number} close VG+-equivalent cents of the day's last sale
 * @property {number} sales how many sales that day
 */

/**
 * One candle per UTC day that had sales, oldest first.
 * @param {{ grade: number, priceCents: number, at: number }[]} sales
 * @param {number} gradeStep
 * @returns {Candle[]}
 */
export function dailyCandles(sales, gradeStep) {
  const ordered = [...sales].sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
  const candles = [];
  for (const sale of ordered) {
    const price = vgPlusEquivalent(sale, gradeStep);
    const day = dayOf(sale.at);
    const last = candles.at(-1);
    if (last && last.day === day) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.sales += 1;
    } else {
      candles.push({ day, open: price, high: price, low: price, close: price, sales: 1 });
    }
  }
  return candles;
}

/**
 * Volatility, the 30-day change and the 52-week range, from the candles.
 * @param {Candle[]} candles
 * @param {number} now
 * @returns {{ monthlyVolatility: number | null, change30: number | null,
 *   high52: number | null, low52: number | null, lastClose: number | null }}
 *   volatility and change as fractions (0.12 = 12%); null when there isn't enough history
 */
export function priceStats(candles, now) {
  const dayMs = (candle) => Date.parse(`${candle.day}T00:00:00Z`);
  let monthlyVolatility = null;
  if (candles.length >= 3) {
    const returns = [];
    for (let i = 1; i < candles.length; i += 1) {
      const gapDays = Math.max(1, (dayMs(candles[i]) - dayMs(candles[i - 1])) / DAY_MS);
      returns.push(Math.log(candles[i].close / candles[i - 1].close) / Math.sqrt(gapDays));
    }
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    monthlyVolatility = Math.sqrt(variance) * Math.sqrt(30);
  }
  const lastClose = candles.at(-1)?.close ?? null;
  const monthAgo = candles.filter((candle) => dayMs(candle) <= now - 30 * DAY_MS).at(-1);
  const year = candles.filter((candle) => dayMs(candle) > now - 365 * DAY_MS);
  return {
    monthlyVolatility,
    change30: monthAgo && lastClose !== null ? lastClose / monthAgo.close - 1 : null,
    high52: year.length ? Math.max(...year.map((candle) => candle.high)) : null,
    low52: year.length ? Math.min(...year.map((candle) => candle.low)) : null,
    lastClose,
  };
}

/**
 * The book for each grade: the copies of exactly that grade for sale, against the WANTED
 * ads that would take a copy of that grade (lowest grade at or below it). Across all grades
 * a $17 "VG+ or better" ad and a $7 G+ copy would look like a negative spread, but they can
 * never trade. Within one grade the engine keeps the book uncrossed: a wanted ad and a copy
 * from different traders that met would already have traded. (One trader's own ad and copy
 * can meet, since nobody trades with themselves; the spread then reads $0 or less.)
 * @param {{ priceCents: number, minGrade: number }[]} bids
 * @param {{ priceCents: number, grade: number }[]} asks
 * @returns {Record<number, ReturnType<typeof depth>>} by grade rank, for every grade with a
 *   copy for sale or a wanted ad that would take one
 */
export function depthByGrade(bids, asks) {
  const byGrade = {};
  for (let grade = 1; grade <= 8; grade += 1) {
    const gradeAsks = asks.filter((ask) => ask.grade === grade);
    const gradeBids = bids.filter((bid) => bid.minGrade <= grade);
    if (gradeAsks.length || gradeBids.length) byGrade[grade] = depth(gradeBids, gradeAsks);
  }
  return byGrade;
}

/**
 * The book as cumulative staircases. Every order is one copy.
 * @param {{ priceCents: number }[]} bids open WANTED ads
 * @param {{ priceCents: number }[]} asks open FOR SALE ads
 * @returns {{ bids: { priceCents: number, copies: number }[],
 *   asks: { priceCents: number, copies: number }[],
 *   spread: { bidCents: number, askCents: number, cents: number, share: number } | null }}
 *   bids from the highest price down (copies wanted at that price or more), asks from the
 *   lowest up (copies for sale at that price or less); spread when both sides have ads
 */
export function depth(bids, asks) {
  const staircase = (orders, better) => {
    const prices = orders.map((order) => order.priceCents).sort(better);
    const steps = [];
    for (const priceCents of prices) {
      const last = steps.at(-1);
      if (last && last.priceCents === priceCents) last.copies += 1;
      else steps.push({ priceCents, copies: (last?.copies ?? 0) + 1 });
    }
    return steps;
  };
  const bidSteps = staircase(bids, (a, b) => b - a);
  const askSteps = staircase(asks, (a, b) => a - b);
  const spread =
    bidSteps.length && askSteps.length
      ? {
          bidCents: bidSteps[0].priceCents,
          askCents: askSteps[0].priceCents,
          cents: askSteps[0].priceCents - bidSteps[0].priceCents,
          share: (askSteps[0].priceCents - bidSteps[0].priceCents) / askSteps[0].priceCents,
        }
      : null;
  return { bids: bidSteps, asks: askSteps, spread };
}
