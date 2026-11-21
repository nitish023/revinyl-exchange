/**
 * "Stay on top" repricing rules (Part 15). Spec: docs/parts/part-15-expiry-repricing.md.
 * Tests: repricing.test.js. Pure: OrderService decides when to run it and makes the change.
 *
 * A FOR SALE ad with a rule keeps itself the cheapest copy of its grade: when another
 * seller lists that grade for less, it drops to `step` under them, but never below its
 * floor. A WANTED ad keeps itself the best offer for its lowest grade: when another buyer
 * offers more, it rises to `step` over them, but never above its ceiling. Rules only ever
 * move a price towards a sale (asks down, bids up), and each move is at least a cent, so a
 * price war between two rules ends at the floors and ceilings.
 */

/**
 * @typedef {object} RuleOrder an open order with a rule, as the database has it
 * @property {number} id
 * @property {number} userId
 * @property {'bid' | 'ask'} side
 * @property {number} priceCents
 * @property {number} stepCents
 * @property {number} limitCents floor for an ask, ceiling for a bid
 * @property {number} [grade] an ask's copy grade
 * @property {number} [minGrade] a bid's lowest grade
 */

/**
 * The price a rule wants now, or null to stay put.
 * @param {RuleOrder} order
 * @param {{ userId: number, side: string, priceCents: number, grade?: number, minGrade?: number }[]} resting
 *   every resting order on the pressing (the book)
 * @returns {number | null}
 */
export function repriceTarget(order, resting) {
  if (order.side === 'ask') {
    const rivals = resting.filter(
      (other) =>
        other.side === 'ask' && other.userId !== order.userId && other.grade === order.grade,
    );
    if (rivals.length === 0) return null;
    const cheapest = Math.min(...rivals.map((other) => other.priceCents));
    const wanted = Math.max(order.limitCents, cheapest - order.stepCents);
    return wanted < order.priceCents ? wanted : null;
  }
  const rivals = resting.filter(
    (other) =>
      other.side === 'bid' && other.userId !== order.userId && other.minGrade === order.minGrade,
  );
  if (rivals.length === 0) return null;
  const highest = Math.max(...rivals.map((other) => other.priceCents));
  const wanted = Math.min(order.limitCents, highest + order.stepCents);
  return wanted > order.priceCents ? wanted : null;
}

/**
 * The first rule (oldest order first) that wants to move, and to where.
 * @param {RuleOrder[]} rules
 * @param {object[]} resting
 * @param {Set<number>} skip orders that couldn't move this turn (a bid without the cash)
 * @returns {{ order: RuleOrder, priceCents: number } | null}
 */
export function nextReprice(rules, resting, skip = new Set()) {
  for (const order of [...rules].sort((a, b) => a.id - b.id)) {
    if (skip.has(order.id)) continue;
    const priceCents = repriceTarget(order, resting);
    if (priceCents !== null) return { order, priceCents };
  }
  return null;
}
