/**
 * Reads a pressing's market from the database: open FOR SALE and WANTED ads, and its
 * sales. Three small queries; the shaping happens in marketView.js.
 *
 * A trader's count is their completed trades (as buyer or seller), so "Seller, 54
 * trades" means 54 records that arrived and were checked.
 */
import { buildMarket } from './marketView.js';

/** How many sales to read: enough for 30 days of a busy pressing plus the sale before each grade. */
const SALES_TO_READ = 200;

const TRADE_COUNT = `(SELECT count(*) FROM trades t
                      WHERE t.status = 'completed' AND (t.buyer_id = u.id OR t.seller_id = u.id))`;

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} releaseId
 * @returns {Promise<import('../../../shared/market.js').Market>}
 */
export async function loadMarket(db, releaseId, now = Date.now()) {
  const [asks, bids, sales] = await Promise.all([
    db.query(
      `SELECT o.id AS "orderId", o.price_cents AS "priceCents", o.created_at AS "createdAt",
              c.id AS "copyId", c.grade, c.sleeve_grade AS "sleeveGrade", c.flags, c.headline, c.notes,
              (SELECT count(*) FROM copy_photos p WHERE p.copy_id = c.id) AS photos,
              u.display_name AS "sellerName", ${TRADE_COUNT} AS "sellerTrades"
         FROM orders o
         JOIN copies c ON c.id = o.copy_id
         JOIN users u ON u.id = o.user_id
        WHERE o.release_id = $1 AND o.side = 'ask' AND o.status = 'open'`,
      [releaseId],
    ),
    db.query(
      `SELECT o.id AS "orderId", o.price_cents AS "priceCents", o.min_grade AS "minGrade",
              o.note, o.created_at AS "createdAt", ${TRADE_COUNT} AS "buyerTrades"
         FROM orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.release_id = $1 AND o.side = 'bid' AND o.status = 'open'`,
      [releaseId],
    ),
    db.query(
      `SELECT grade, price_cents AS "priceCents", created_at AS "createdAt"
         FROM trades
        WHERE release_id = $1 AND status <> 'refunded'
        ORDER BY created_at DESC, id DESC
        LIMIT ${SALES_TO_READ}`,
      [releaseId],
    ),
  ]);
  return buildMarket({ releaseId, asks: asks.rows, bids: bids.rows, sales: sales.rows, now });
}

/**
 * The ids of my open orders on a pressing, so the page can mark "your ad" (and Part 5
 * can hide "Buy this copy" on it). Kept out of the shared market, which everyone gets.
 * @param {import('pg').Pool} db
 * @param {number} releaseId
 * @param {number} userId
 * @returns {Promise<number[]>}
 */
export async function myOpenOrderIds(db, releaseId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM orders WHERE release_id = $1 AND user_id = $2 AND status = 'open' ORDER BY id`,
    [releaseId, userId],
  );
  return rows.map((row) => row.id);
}
