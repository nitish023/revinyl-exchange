/**
 * The market page (Part 4): what the live connection accepts, and the shapes the server
 * sends, so the browser and the server agree.
 *
 * The browser opens one WebSocket to /ws and sends
 *   { "type": "subscribe", "releaseId": 249504 }   start getting that pressing's market
 *   { "type": "unsubscribe", "releaseId": 249504 }
 * The server sends
 *   { "type": "market", "releaseId", "market" }    the whole market, on subscribe and on every change
 *   { "type": "order" | "trade" | "wallet", ... }  something private to you changed (logged in only)
 *   { "type": "error", "message" }                 a request it couldn't do
 */
import { z } from 'zod';

/** The Market Report covers this many days of sales. */
export const REPORT_WINDOW_DAYS = 30;
/** How many sales the "Recent sales" list shows. */
export const RECENT_SALES_LIMIT = 8;
/** One browser tab rarely needs more; it stops one connection from watching every pressing. */
export const MAX_SUBSCRIPTIONS = 20;

export const liveRequestSchema = z.object({
  type: z.enum(['subscribe', 'unsubscribe']),
  releaseId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

/**
 * @typedef {object} MarketAd a FOR SALE ad
 * @property {number} orderId
 * @property {string} price "42.00"
 * @property {string} listedAt ISO date
 * @property {{ id: number, grade: number, sleeveGrade: number | null, condition: string,
 *   flags: string[], headline: string, notes: string, photos: number }} copy
 * @property {{ name: string, trades: number }} seller sellers sign their ads; buyers never do
 */

/**
 * @typedef {object} WantedAd
 * @property {number} orderId
 * @property {string} price the most the buyer will pay
 * @property {number} minGrade
 * @property {string} note
 * @property {string} postedAt
 * @property {{ trades: number }} buyer no name: "Buyer, 9 trades"
 */

/**
 * @typedef {object} GradeReport sales of one grade in the report window
 * @property {number} grade
 * @property {string} last
 * @property {string | null} change last minus the sale before it in this grade, "-2.00"
 * @property {string} low
 * @property {string} high
 * @property {number} sales
 */

/**
 * @typedef {object} Market
 * @property {number} releaseId
 * @property {string} asOf
 * @property {{ grade: number, ads: MarketAd[] }[]} forSale best grade first, cheapest first inside
 * @property {WantedAd[]} wanted highest price first
 * @property {{ highestBid: { price: string, minGrade: number } | null,
 *   lowestAsk: { price: string, grade: number } | null,
 *   byGrade: GradeReport[], recentSales: { grade: number, price: string, soldAt: string }[],
 *   lastSale: { grade: number, price: string, soldAt: string } | null }} report
 */
