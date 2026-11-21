/**
 * A trader's portfolio (Part 18): what their records are worth, what they paid, and what
 * they've made. Spec: docs/parts/part-18-index-portfolio.md. Tests: portfolio.test.js.
 * Pure: the pricing service reads the rows and the fair values.
 *
 *   cost basis   every copy is unique, so it's specific identification: what you paid for
 *                that very copy on reVINYL. A copy you added by hand or imported has no
 *                cost basis (we don't know what you paid), so it counts towards what your
 *                records are worth but not towards your gains.
 *   holdings     the copies you own (in the crate, listed, up for auction, or sold and not
 *                yet paid out) and the ones you've bought that are on their way, marked to
 *                Part 13's fair value for their grade
 *   unrealized   fair value − cost, for holdings with a cost basis
 *   realized     what a sale paid you (price − the seller's fee) − what you'd paid for that
 *                copy, for completed sales of copies you'd bought here
 *   return       (realized + unrealized) ÷ the cost of those positions
 */

/**
 * @typedef {object} Holding
 * @property {number} copyId
 * @property {number} releaseId
 * @property {number} grade
 * @property {string} status in_crate | listed | in_auction | in_trade | on_its_way
 * @property {number | null} costCents what this copy cost you, if you bought it here
 */

/**
 * @typedef {object} Sale a completed sale of yours
 * @property {number} tradeId
 * @property {number} releaseId
 * @property {number} grade
 * @property {number} proceedsCents price − fee
 * @property {number | null} costCents what you'd paid for the copy, if you bought it here
 * @property {number | null} heldDays how long you had it, if you bought it here
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Who owned a copy at time t: the buyer of the latest trade made on it by then (a copy you
 * paid for counts as yours while it's in the post), or before any trade, whoever sold it
 * first (or, with no trades at all, its owner now).
 */
function ownerAt(copy, trades, t) {
  let owner = trades.length ? trades[0].sellerId : copy.ownerId;
  for (const trade of trades) {
    if (trade.at > t) break;
    owner = trade.buyerId;
  }
  return owner;
}

/**
 * Net worth day by day (Part 18): cash from the ledger, plus every copy owned that day at
 * its pressing's level that day, a VG+ copy's weekly average price (the geometric mean of
 * the week's clean sales, carried forward through quiet weeks; Part 14's reasoning), moved
 * to the copy's grade. A pressing that hasn't sold yet adds nothing.
 * @param {{ userId: number, now: number, days?: number,
 *   cash: { at: number, amountCents: number }[],
 *   copies: { id: number, ownerId: number, releaseId: number, grade: number,
 *     createdAt: number, removedAt: number | null }[],
 *   trades: { copyId: number, buyerId: number, sellerId: number, at: number }[],
 *   markets: Map<number, { gradeStep: number, sales: { at: number, vgPlusCents: number }[] }> }} input
 *   trades: every non-refunded trade on those copies, by anyone
 * @returns {{ day: string, cashCents: number, holdingsCents: number, netWorthCents: number }[]}
 */
export function portfolioSeries({ userId, now, days = 90, cash, copies, trades, markets }) {
  const tradesByCopy = new Map();
  for (const trade of [...trades].sort((a, b) => a.at - b.at)) {
    tradesByCopy.set(trade.copyId, [...(tradesByCopy.get(trade.copyId) ?? []), trade]);
  }
  const levelAt = (releaseId, t) => {
    const market = markets.get(releaseId);
    if (!market) return null;
    const past = market.sales.filter((sale) => sale.at <= t);
    if (past.length === 0) return null;
    const lastAt = past.at(-1).at;
    const week = past.filter((sale) => sale.at > lastAt - WEEK_MS);
    return Math.exp(week.reduce((sum, sale) => sum + Math.log(sale.vgPlusCents), 0) / week.length);
  };
  const ordered = [...cash].sort((a, b) => a.at - b.at);
  const series = [];
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  for (let back = days - 1; back >= 0; back -= 1) {
    const dayStart = today - back * DAY_MS;
    const end = Math.min(dayStart + DAY_MS - 1, now);
    const cashCents = ordered
      .filter((entry) => entry.at <= end)
      .reduce((sum, e) => sum + e.amountCents, 0);
    let holdingsCents = 0;
    for (const copy of copies) {
      if (copy.createdAt > end || (copy.removedAt !== null && copy.removedAt <= end)) continue;
      if (ownerAt(copy, tradesByCopy.get(copy.id) ?? [], end) !== userId) continue;
      const level = levelAt(copy.releaseId, end);
      if (level === null) continue;
      holdingsCents += Math.round(
        level * Math.exp(markets.get(copy.releaseId).gradeStep * (copy.grade - 6)),
      );
    }
    series.push({
      day: new Date(dayStart).toISOString().slice(0, 10),
      cashCents,
      holdingsCents,
      netWorthCents: cashCents + holdingsCents,
    });
  }
  return series;
}

/**
 * @param {{ holdings: Holding[], sales: Sale[], cashCents: number,
 *   fairValue: (releaseId: number, grade: number) => number | null }} input
 */
export function buildPortfolio({ holdings, sales, cashCents, fairValue }) {
  const marked = holdings.map((holding) => {
    const fairCents = fairValue(holding.releaseId, holding.grade);
    return {
      ...holding,
      fairCents,
      unrealizedCents:
        holding.costCents !== null && fairCents !== null ? fairCents - holding.costCents : null,
    };
  });
  const realized = sales.map((sale) => ({
    ...sale,
    gainCents: sale.costCents === null ? null : sale.proceedsCents - sale.costCents,
  }));

  const sum = (items, pick) => items.reduce((total, item) => total + (pick(item) ?? 0), 0);
  const holdingsCents = sum(marked, (h) => h.fairCents);
  const unrealizedCents = sum(marked, (h) => h.unrealizedCents);
  const realizedCents = sum(realized, (s) => s.gainCents);
  const invested =
    sum(
      marked.filter((h) => h.unrealizedCents !== null),
      (h) => h.costCents,
    ) +
    sum(
      realized.filter((s) => s.gainCents !== null),
      (s) => s.costCents,
    );
  return {
    holdings: marked,
    realized,
    totals: {
      cashCents,
      holdingsCents,
      netWorthCents: cashCents + holdingsCents,
      unrealizedCents,
      realizedCents,
      investedCents: invested,
      returnShare: invested > 0 ? (realizedCents + unrealizedCents) / invested : null,
      unpriced: marked.filter((h) => h.fairCents === null).length,
    },
  };
}
