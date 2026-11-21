/**
 * The reVINYL 30 (Part 18): one number for how the whole record market is doing, built the
 * way a stock index is. Spec: docs/parts/part-18-index-portfolio.md. Tests: marketIndex.test.js.
 * Pure: the index service reads the sales and calls buildIndex.
 *
 *   members    the 30 pressings with the most money traded over the 90 days before each
 *              rebalance (clean sales only: Part 17's flagged trades don't count)
 *   prices     each member's latest sale restated as a VG+ copy (Part 14), carried forward
 *              on days it doesn't trade
 *   weights    by traded value: at a rebalance each member gets q = its 90-day traded value
 *              ÷ its price, so its share of the index is its share of the money traded; until
 *              the next rebalance the shares q stay put and weights drift with prices, like
 *              a cap-weighted index's
 *   level      Σ q·price ÷ divisor, starting at 1,000. When the members or their q change at
 *              a rebalance (weekly), the divisor is reset so the level doesn't move that day:
 *              only price changes move the index, never a change of membership.
 */

const DAY_MS = 86_400_000;
export const INDEX_BASE = 1000;
export const INDEX_SIZE = 30;
export const LOOKBACK_DAYS = 90;
export const REBALANCE_DAYS = 7;

const startOfDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * @typedef {object} IndexSale
 * @property {number} releaseId
 * @property {number} priceCents already restated as VG+
 * @property {number} at ms
 */

/**
 * @param {IndexSale[]} sales clean sales, any order
 * @param {{ now: number, days?: number, size?: number, rebalanceDays?: number }} options
 *   `days` of history to chart, ending today
 * @returns {{ series: { day: string, level: number }[],
 *   members: { releaseId: number, weight: number, priceCents: number, shares: number }[],
 *   divisor: number | null, rebalancedOn: string | null }}
 */
export function buildIndex(
  sales,
  { now, days = LOOKBACK_DAYS, size = INDEX_SIZE, rebalanceDays = REBALANCE_DAYS },
) {
  const ordered = [...sales].sort((a, b) => a.at - b.at);
  const today = startOfDay(now);
  const first = today - (days - 1) * DAY_MS;

  // Each pressing's latest price as of the end of a day: walk the sales once, day by day.
  const latest = new Map();
  let next = 0;
  const advanceTo = (dayEnd) => {
    while (next < ordered.length && ordered[next].at < dayEnd) {
      latest.set(ordered[next].releaseId, ordered[next].priceCents);
      next += 1;
    }
  };

  /** Members and shares for a rebalance on the day ending at `dayEnd`. */
  const choose = (dayEnd) => {
    const traded = new Map();
    for (const sale of ordered) {
      if (sale.at >= dayEnd) break;
      if (sale.at >= dayEnd - LOOKBACK_DAYS * DAY_MS) {
        traded.set(sale.releaseId, (traded.get(sale.releaseId) ?? 0) + sale.priceCents);
      }
    }
    return [...traded]
      .filter(([releaseId]) => latest.has(releaseId))
      .sort(([idA, a], [idB, b]) => b - a || idA - idB)
      .slice(0, size)
      .map(([releaseId, value]) => ({ releaseId, shares: value / latest.get(releaseId) }));
  };
  const basketValue = (basket) =>
    basket.reduce((sum, member) => sum + member.shares * latest.get(member.releaseId), 0);

  const series = [];
  let basket = [];
  let divisor = null;
  let rebalancedOn = null;
  let level = INDEX_BASE;
  for (let day = first, n = 0; day <= today; day += DAY_MS, n += 1) {
    const dayEnd = day + DAY_MS;
    advanceTo(dayEnd);
    const label = new Date(day).toISOString().slice(0, 10);
    if (divisor !== null) level = basketValue(basket) / divisor;
    if (divisor === null || n % rebalanceDays === 0) {
      const chosen = choose(dayEnd);
      if (chosen.length > 0) {
        basket = chosen;
        // Reset the divisor so today's level is the same with the new members.
        divisor = basketValue(basket) / level;
        rebalancedOn = label;
      }
    }
    if (divisor !== null) series.push({ day: label, level });
  }

  const total = basket.length ? basketValue(basket) : 0;
  return {
    series,
    members: basket
      .map((member) => ({
        releaseId: member.releaseId,
        shares: member.shares,
        priceCents: latest.get(member.releaseId),
        weight: (member.shares * latest.get(member.releaseId)) / total,
      }))
      .sort((a, b) => b.weight - a.weight),
    divisor,
    rebalancedOn,
  };
}
