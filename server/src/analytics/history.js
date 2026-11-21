/**
 * Price history and depth for a pressing (Part 14). Spec: docs/parts/part-14-history.md.
 * Tests: history.test.js. Pure: pricingService.js reads the data and calls these.
 *
 * Sales of different grades can't share a chart as they are: a Mint copy selling for $60
 * after a VG one for $20 isn't the price tripling. So every sale is first restated as its
 * VG+ equivalent, price × e^(-b·(grade − VG+)), with b the pressing's fitted grade premium
 * (fairValue.js). Then, as for a stock:
 *   - daily candles (UTC days): open, high, low and close of the day's sales, and how many;
 *   - volatility and the 30-day change, measured on weekly averages (see priceStats);
 *   - the 52-week high and low.
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

const WEEK_MS = 7 * DAY_MS;

/** The geometric mean of the prices of the points in (from, to], or null if none. */
function levelBetween(points, from, to) {
  const inside = points.filter((point) => point.at > from && point.at <= to);
  if (inside.length === 0) return null;
  return Math.exp(inside.reduce((sum, point) => sum + Math.log(point.price), 0) / inside.length);
}

/**
 * Volatility, the 30-day change and the 52-week range, in VG+ terms.
 *
 * Every copy is different, so two sales on the same day can be 30% apart for reasons that
 * have nothing to do with the market (one plays a little cleaner). Measured sale to sale,
 * that scatter would read as huge volatility. So, like the price of any thinly traded
 * asset, the market's level is taken as a weekly average (the geometric mean of a week's
 * sales), and volatility and change are measured on that:
 *   - volatility: the standard deviation of the log change between one week's level and
 *     the next week with sales (divided by √weeks between, so a gap doesn't read as calm),
 *     stated for a month (× √(30/7));
 *   - the 30-day change: the last 7 days' level against the 7 days ending 30 days ago.
 * @param {{ grade: number, priceCents: number, at: number }[]} sales
 * @param {number} gradeStep
 * @param {number} now
 * @returns {{ monthlyVolatility: number | null, change30: number | null,
 *   high30: number | null, low30: number | null,
 *   high52: number | null, low52: number | null, lastClose: number | null }}
 *   volatility and change as fractions (0.12 = 12%); null when there isn't enough history
 */
export function priceStats(sales, gradeStep, now) {
  const points = sales
    .map((sale) => ({ at: sale.at, price: vgPlusEquivalent(sale, gradeStep) }))
    .sort((a, b) => a.at - b.at);
  const year = points.filter((point) => point.at > now - 365 * DAY_MS);

  const weeks = [];
  for (let back = 51; back >= 0; back -= 1) {
    const to = now - back * WEEK_MS;
    const level = levelBetween(points, to - WEEK_MS, to);
    if (level !== null) weeks.push({ back, level });
  }
  let monthlyVolatility = null;
  if (weeks.length >= 3) {
    const returns = weeks
      .slice(1)
      .map(
        (week, i) => Math.log(week.level / weeks[i].level) / Math.sqrt(weeks[i].back - week.back),
      );
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.length > 1
        ? returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1)
        : 0;
    monthlyVolatility = Math.sqrt(variance) * Math.sqrt(30 / 7);
  }
  const recent = levelBetween(points, now - WEEK_MS, now);
  const monthAgo = levelBetween(points, now - 30 * DAY_MS - WEEK_MS, now - 30 * DAY_MS);
  const month = points.filter((point) => point.at > now - 30 * DAY_MS);
  const range = (list, pick) => (list.length ? pick(...list.map((point) => point.price)) : null);
  return {
    monthlyVolatility,
    change30: recent !== null && monthAgo !== null ? recent / monthAgo - 1 : null,
    high30: range(month, Math.max),
    low30: range(month, Math.min),
    high52: range(year, Math.max),
    low52: range(year, Math.min),
    lastClose: points.at(-1)?.price ?? null,
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
