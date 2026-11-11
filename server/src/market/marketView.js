/**
 * Turns a pressing's open orders and sales into what the market page shows. Pure, so the
 * rules (grouping, ordering, the report numbers) are tested without a database.
 * marketRepo.js does the SQL and calls buildMarket.
 */
import { conditionText } from '../../../shared/copies.js';
import { RECENT_SALES_LIMIT, REPORT_WINDOW_DAYS } from '../../../shared/market.js';
import { formatCents } from '../../../shared/orders.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} AskRow an open ask joined to its copy
 * @property {number} orderId
 * @property {number} priceCents
 * @property {Date} createdAt
 * @property {number} copyId
 * @property {number} grade
 * @property {number | null} sleeveGrade
 * @property {string[]} flags
 * @property {string} headline
 * @property {string} notes
 * @property {number} photos
 * @property {string} sellerName
 * @property {number} sellerTrades
 *
 * @typedef {object} BidRow
 * @property {number} orderId
 * @property {number} priceCents
 * @property {number} minGrade
 * @property {string} note
 * @property {Date} createdAt
 * @property {number} buyerTrades
 *
 * @typedef {object} SaleRow a trade that wasn't refunded
 * @property {number} grade
 * @property {number} priceCents
 * @property {Date} createdAt
 */

const earliestFirst = (a, b) => a.createdAt - b.createdAt || a.orderId - b.orderId;

/** Same order as the engine (OrderBook.asks / bids), so the top ad is the one that fills. */
const cheapestFirst = (a, b) => a.priceCents - b.priceCents || earliestFirst(a, b);
const highestFirst = (a, b) => b.priceCents - a.priceCents || earliestFirst(a, b);

/** @param {AskRow} row */
function toAd(row) {
  return {
    orderId: row.orderId,
    price: formatCents(row.priceCents),
    listedAt: row.createdAt.toISOString(),
    copy: {
      id: row.copyId,
      grade: row.grade,
      sleeveGrade: row.sleeveGrade,
      condition: conditionText(row.grade, row.sleeveGrade),
      flags: row.flags,
      headline: row.headline,
      notes: row.notes,
      photos: row.photos,
    },
    seller: { name: row.sellerName, trades: row.sellerTrades },
  };
}

/** @param {BidRow} row */
function toWanted(row) {
  return {
    orderId: row.orderId,
    price: formatCents(row.priceCents),
    minGrade: row.minGrade,
    note: row.note,
    postedAt: row.createdAt.toISOString(),
    buyer: { trades: row.buyerTrades },
  };
}

const toSale = (row) => ({
  grade: row.grade,
  price: formatCents(row.priceCents),
  soldAt: row.createdAt.toISOString(),
});

/**
 * For each grade sold in the window: the last price, the change from the sale before it
 * (which may be older than the window), and the low and high inside the window.
 * @param {SaleRow[]} newestFirst
 */
function gradeReports(newestFirst, now) {
  const since = now - REPORT_WINDOW_DAYS * DAY_MS;
  const byGrade = new Map();
  for (const sale of newestFirst) {
    const list = byGrade.get(sale.grade) ?? [];
    list.push(sale);
    byGrade.set(sale.grade, list);
  }
  const reports = [];
  for (const [grade, sales] of byGrade) {
    const recent = sales.filter((sale) => sale.createdAt.getTime() >= since);
    if (recent.length === 0) continue;
    const prices = recent.map((sale) => sale.priceCents);
    const [last, previous] = sales;
    reports.push({
      grade,
      last: formatCents(last.priceCents),
      change: previous ? formatCents(last.priceCents - previous.priceCents) : null,
      low: formatCents(Math.min(...prices)),
      high: formatCents(Math.max(...prices)),
      sales: recent.length,
    });
  }
  return reports.sort((a, b) => b.grade - a.grade);
}

/**
 * @param {{ releaseId: number, asks: AskRow[], bids: BidRow[], sales: SaleRow[], now: number }} input
 *   sales: newest first
 * @returns {import('../../../shared/market.js').Market}
 */
export function buildMarket({ releaseId, asks, bids, sales, now }) {
  const groups = new Map();
  for (const ask of asks) {
    const list = groups.get(ask.grade) ?? [];
    list.push(ask);
    groups.set(ask.grade, list);
  }
  const forSale = [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([grade, rows]) => ({ grade, ads: rows.sort(cheapestFirst).map(toAd) }));

  const sortedBids = [...bids].sort(highestFirst);
  const cheapest = [...asks].sort(cheapestFirst)[0];
  const newestFirst = [...sales].sort((a, b) => b.createdAt - a.createdAt);

  return {
    releaseId,
    asOf: new Date(now).toISOString(),
    forSale,
    wanted: sortedBids.map(toWanted),
    report: {
      highestBid: sortedBids[0]
        ? { price: formatCents(sortedBids[0].priceCents), minGrade: sortedBids[0].minGrade }
        : null,
      lowestAsk: cheapest
        ? { price: formatCents(cheapest.priceCents), grade: cheapest.grade }
        : null,
      lastSale: newestFirst[0] ? toSale(newestFirst[0]) : null,
      byGrade: gradeReports(newestFirst, now),
      recentSales: newestFirst.slice(0, RECENT_SALES_LIMIT).map(toSale),
    },
  };
}
