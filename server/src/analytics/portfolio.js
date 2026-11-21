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
