/**
 * A seller's record and standing (Part 12): their level, fee and reliability, from their
 * trades. Spec: docs/parts/part-12-fees.md. The rules themselves are in shared/fees.js.
 */
import {
  formatCents,
  LEVEL_WINDOW_DAYS,
  payoutFor,
  percentText,
  SELLER_LEVELS,
  standingOf,
} from '../../../shared/index.js';

/** Part 17: sales to one buyer that count towards a level, per 90 days. */
export const MAX_COUNTED_PER_BUYER = 2;

/**
 * Completed sales and their value in the last 90 days, and all-time completed and refunded
 * sales, as the seller. A sale counts towards a level when it completed (the buyer accepted
 * the record), not when it was made.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} userId
 * @param {Date} [now]
 * @returns {Promise<import('../../../shared/fees.js').SellerRecord>}
 */
export async function loadSellerRecord(db, userId, now = new Date()) {
  // Part 17: levels can't be bought by trading with a friend. A sale whose copy came back to
  // this seller from the buyer within 30 days (a round trip) doesn't count, and at most
  // MAX_COUNTED_PER_BUYER sales to any one buyer count in the window.
  const { rows } = await db.query(
    `WITH counted AS (
       SELECT t.price_cents,
              row_number() OVER (PARTITION BY t.buyer_id ORDER BY t.settled_at, t.id) AS nth
         FROM trades t
        WHERE t.seller_id = $1 AND t.status = 'completed' AND t.settled_at > $2
          AND NOT EXISTS (
                SELECT 1 FROM trades back
                 WHERE back.copy_id = t.copy_id AND back.id <> t.id AND back.status <> 'refunded'
                   AND back.seller_id = t.buyer_id AND back.buyer_id = t.seller_id
                   AND abs(extract(epoch FROM back.created_at - t.created_at)) < 30 * 86400)
     )
     SELECT (SELECT count(*) FROM counted WHERE nth <= $3) AS sales90,
            (SELECT coalesce(sum(price_cents), 0)::bigint FROM counted WHERE nth <= $3) AS volume90,
            (SELECT count(*) FROM trades WHERE seller_id = $1 AND status = 'completed') AS completed,
            (SELECT count(*) FROM trades WHERE seller_id = $1 AND status = 'refunded') AS refunded`,
    [userId, new Date(now.getTime() - LEVEL_WINDOW_DAYS * 86_400_000), MAX_COUNTED_PER_BUYER],
  );
  const row = rows[0];
  return {
    sales90: row.sales90,
    volume90Cents: row.volume90,
    completed: row.completed,
    refunded: row.refunded,
  };
}

/**
 * The fee a sale at this price costs this seller right now. The order service calls it
 * inside the trade's transaction and stores the result on the trade, so the fee is the one
 * that applied when the sale was made, whatever the seller's level is by payout time.
 * @param {import('pg').PoolClient} client
 * @param {number} sellerId
 * @param {number} priceCents
 */
export async function sellerFeeFor(client, sellerId, priceCents) {
  const { level } = standingOf(await loadSellerRecord(client, sellerId));
  return payoutFor(priceCents, level).feeCents;
}

/**
 * Everything the Listening Room and the sell forms show about you as a seller.
 * @param {import('pg').Pool} db
 * @param {number} userId
 */
export async function loadStanding(db, userId) {
  const record = await loadSellerRecord(db, userId);
  const standing = standingOf(record);
  return {
    level: standing.level,
    feeBps: standing.feeBps,
    fee: percentText(standing.feeBps),
    reliability: Math.round(standing.reliability * 1000) / 1000,
    sales90: record.sales90,
    volume90: formatCents(record.volume90Cents),
    completed: record.completed,
    refunded: record.refunded,
    next: standing.next && {
      level: standing.next.level,
      salesNeeded: standing.next.salesNeeded,
      volumeNeeded: formatCents(standing.next.volumeNeededCents),
      reliabilityNeeded: standing.next.reliabilityNeeded,
      fee: percentText(
        SELLER_LEVELS.find((tier) => tier.level === standing.next.level).transactionFeeBps + 300,
      ),
    },
  };
}
