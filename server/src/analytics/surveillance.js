/**
 * Market surveillance (Part 17): trades that look like wash trading, so they can be kept
 * out of fair value, the price history and the models. Spec: docs/parts/part-17-surveillance.md.
 * Tests: surveillance.test.js. Pure: the pricing service feeds it a pressing's trades.
 *
 * Wash trading is trading with yourself, or a friend, to make a price or a volume that
 * isn't real: sell a copy to a friend at $200 and buy it back, and the "last sale" says
 * $200. Two patterns are flagged, within 30 days:
 *   round_trip  a copy comes back to someone who sold it (A→B→A, or round a ring A→B→C→A):
 *               every trade on the way round is flagged, since none of them moved the copy
 *               anywhere for real
 *   pair_churn  the same two traders trade with each other three or more times, in either
 *               direction: real collectors don't keep selling to the same person
 * A flag is a reason to doubt a trade, not proof, so flagged trades are only set aside from
 * the numbers; the trades themselves stand.
 */

export const WINDOW_DAYS = 30;
const PAIR_LIMIT = 3;
const DAY_MS = 86_400_000;

/**
 * @typedef {object} TradeFact
 * @property {number} id
 * @property {number} copyId
 * @property {number} buyerId
 * @property {number} sellerId
 * @property {number} at ms
 */

const groupBy = (items, key) => {
  const groups = new Map();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
};

/**
 * @param {TradeFact[]} trades a pressing's trades (refunded ones left out by the caller)
 * @param {{ windowDays?: number }} [options]
 * @returns {Map<number, Set<'round_trip' | 'pair_churn'>>} reasons, by trade id
 */
export function findWashTrades(trades, { windowDays = WINDOW_DAYS } = {}) {
  const window = windowDays * DAY_MS;
  const flags = new Map();
  const flag = (trade, reason) => {
    if (!flags.has(trade.id)) flags.set(trade.id, new Set());
    flags.get(trade.id).add(reason);
  };
  const oldestFirst = (list) => [...list].sort((a, b) => a.at - b.at || a.id - b.id);

  // A copy that comes back to a previous seller: flag the whole way round.
  for (const list of groupBy(trades, (t) => t.copyId).values()) {
    const path = oldestFirst(list);
    for (let k = 1; k < path.length; k += 1) {
      for (let j = 0; j < k; j += 1) {
        if (path[k].at - path[j].at <= window && path[k].buyerId === path[j].sellerId) {
          for (let i = j; i <= k; i += 1) flag(path[i], 'round_trip');
        }
      }
    }
  }

  // The same two people trading three or more times inside any 30-day stretch.
  const pairKey = (t) => [t.buyerId, t.sellerId].sort((a, b) => a - b).join(':');
  for (const list of groupBy(trades, pairKey).values()) {
    const ordered = oldestFirst(list);
    let start = 0;
    for (let end = 0; end < ordered.length; end += 1) {
      while (ordered[end].at - ordered[start].at > window) start += 1;
      if (end - start + 1 >= PAIR_LIMIT) {
        for (let i = start; i <= end; i += 1) flag(ordered[i], 'pair_churn');
      }
    }
  }
  return flags;
}

/** The trades with no flag: what prices and models should be built from. */
export function withoutWashTrades(trades, flags = findWashTrades(trades)) {
  return trades.filter((trade) => !flags.has(trade.id));
}
