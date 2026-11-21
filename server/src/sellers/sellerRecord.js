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
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'completed' AND settled_at > $2) AS sales90,
            coalesce(sum(price_cents) FILTER (WHERE status = 'completed' AND settled_at > $2), 0)::bigint
              AS volume90,
            count(*) FILTER (WHERE status = 'completed') AS completed,
            count(*) FILTER (WHERE status = 'refunded') AS refunded
       FROM trades WHERE seller_id = $1`,
    [userId, new Date(now.getTime() - LEVEL_WINDOW_DAYS * 86_400_000)],
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
