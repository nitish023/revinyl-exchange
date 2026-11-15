/**
 * What happens to a trade after the match (Part 5). Spec: docs/parts/part-5-trades.md.
 * Tests: server/test/trades.int.test.js.
 *
 *   awaiting_shipment --ship--> shipped --received--> completed   (seller paid, copy moves to the buyer)
 *          |                       |
 *        cancel (seller)        refund (buyer)
 *          v                       v
 *       refunded               refunded                          (buyer repaid, copy back to the seller)
 *
 * Every change: lock the trade row, check who is asking and the status, change the trade,
 * the wallets and the copy in one transaction, then tell browsers (ctx.live) after COMMIT.
 *
 * The buyer paid when the trade was made (Part 3), so until it settles the price sits in
 * the trade itself: it's in nobody's cash. Settling gives it to exactly one person.
 *
 * Locks, always in this order: the trade, then both people's wallets in id order, then the
 * copy. Two trades between the same two people, going opposite ways, therefore can't each
 * hold one wallet and wait for the other. Trades don't touch the order books, so they don't
 * take a turn in the pressing queue.
 */
import { withTransaction } from '../db/pool.js';
import { AppError, notFound } from '../errors.js';
import { toTradeView } from '../orders/orderRows.js';

/**
 * @typedef {object} TradeView what the API sends back (prices as "40.50" strings)
 * @property {number} id
 * @property {number} releaseId
 * @property {number} copyId
 * @property {'buyer' | 'seller'} role
 * @property {'awaiting_shipment' | 'shipped' | 'completed' | 'refunded'} status
 * @property {string} price
 * @property {number} grade
 * @property {string} createdAt ISO date
 * @property {string | null} shippedAt
 * @property {string | null} settledAt
 */

/**
 * Each step: who may take it, from which status, to which, and who gets the money.
 * `paid` is whose cash the price goes to; `owner` is who owns the copy afterwards.
 */
const STEPS = {
  ship: { by: 'seller', from: 'awaiting_shipment', to: 'shipped' },
  cancel: {
    by: 'seller',
    from: 'awaiting_shipment',
    to: 'refunded',
    paid: 'buyer',
    owner: 'seller',
  },
  received: { by: 'buyer', from: 'shipped', to: 'completed', paid: 'seller', owner: 'buyer' },
  refund: { by: 'buyer', from: 'shipped', to: 'refunded', paid: 'buyer', owner: 'seller' },
};

/** What a trade in each status is waiting for, said to the person who tried the wrong step. */
const WAITING_FOR = {
  awaiting_shipment: 'It hasn’t been shipped yet.',
  shipped: 'It has already been shipped.',
  completed: 'It’s already completed.',
  refunded: 'It has already been refunded.',
};

const ONLY = {
  seller: 'Only the seller can do that.',
  buyer: 'Only the buyer can do that.',
};

export class TradeService {
  /**
   * @param {{ pool: import('pg').Pool, live: import('../market/live.js').LiveUpdates }} deps
   */
  constructor({ pool, live }) {
    this.pool = pool;
    this.live = live;
  }

  /**
   * Seller marks the record as sent: awaiting_shipment -> shipped. Nothing else moves.
   * @param {{ id: number }} user
   * @param {number} tradeId
   * @returns {Promise<TradeView>}
   */
  ship(user, tradeId) {
    return this.#step(user, tradeId, 'ship');
  }

  /**
   * Seller backs out before shipping: awaiting_shipment -> refunded. The buyer gets the
   * price back and the copy returns to the seller's crate.
   */
  cancel(user, tradeId) {
    return this.#step(user, tradeId, 'cancel');
  }

  /**
   * Buyer confirms it arrived as described: shipped -> completed. The seller is paid and the
   * copy becomes the buyer's (owner_id), back to `in_crate`.
   */
  received(user, tradeId) {
    return this.#step(user, tradeId, 'received');
  }

  /**
   * Buyer says it isn't as described: shipped -> refunded. The buyer gets the price back and
   * the copy returns to the seller's crate.
   */
  refund(user, tradeId) {
    return this.#step(user, tradeId, 'refund');
  }

  /**
   * My trades, newest first, with the pressing (for the ledger).
   * @param {{ id: number }} user
   * @param {{ status?: string }} [filters]
   * @returns {Promise<(TradeView & { release: object })[]>}
   */
  async list(user, { status } = {}) {
    const { rows } = await this.pool.query(
      `SELECT t.*, r.title, r.artist, r.thumb_url
         FROM trades t JOIN releases r ON r.id = t.release_id
        WHERE (t.buyer_id = $1 OR t.seller_id = $1)
          AND ($2::text IS NULL OR t.status = $2)
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 200`,
      [user.id, status ?? null],
    );
    return rows.map((row) => ({
      ...toTradeView(row, user.id),
      release: {
        id: row.release_id,
        title: row.title,
        artist: row.artist,
        thumbUrl: row.thumb_url,
      },
    }));
  }

  /** One step of the lifecycle, all or nothing, then tell the people involved. */
  async #step(user, tradeId, name) {
    const step = STEPS[name];
    const trade = await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query('SELECT * FROM trades WHERE id = $1 FOR UPDATE', [
        tradeId,
      ]);
      const row = rows[0];
      // Someone else's trade is "not found", so ids can't be used to probe other people's.
      if (!row || (row.buyer_id !== user.id && row.seller_id !== user.id)) {
        throw notFound('Trade');
      }
      if (row[`${step.by}_id`] !== user.id) throw new AppError(403, 'NOT_YOUR_STEP', ONLY[step.by]);
      if (row.status !== step.from) {
        throw new AppError(409, 'TRADE_NOT_IN_THAT_STATE', WAITING_FOR[row.status]);
      }

      if (step.paid) {
        // Both wallets, in id order, before anything changes (see the top of this file).
        await client.query(
          'SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
          [[row.buyer_id, row.seller_id]],
        );
        await client.query('UPDATE users SET cash_cents = cash_cents + $2 WHERE id = $1', [
          row[`${step.paid}_id`],
          row.price_cents,
        ]);
        // A copy changing hands drops its Discogs instance id: that belonged to the old
        // owner's collection, and the buyer may have imported the same one (PROJECT.md).
        const { rowCount } = await client.query(
          `UPDATE copies
              SET status = 'in_crate', owner_id = $2,
                  discogs_instance_id = CASE WHEN owner_id = $2 THEN discogs_instance_id END
            WHERE id = $1 AND status = 'in_trade'`,
          [row.copy_id, row[`${step.owner}_id`]],
        );
        // A trade's copy stays in_trade until the trade settles; anything else is a bug.
        if (rowCount !== 1)
          throw new Error(`Copy ${row.copy_id} of trade ${row.id} isn't in a trade`);
      }

      const { rows: updated } = await client.query(
        `UPDATE trades
            SET status = $2,
                shipped_at = CASE WHEN $2 = 'shipped' THEN now() ELSE shipped_at END,
                settled_at = CASE WHEN $2 IN ('completed', 'refunded') THEN now() ELSE settled_at END,
                updated_at = now()
          WHERE id = $1 RETURNING *`,
        [tradeId, step.to],
      );
      return updated[0];
    });

    this.#announce(trade, step);
    return toTradeView(trade, user.id);
  }

  /** Tell browsers. The change is already saved, so a live-update failure must not fail it. */
  #announce(trade, step) {
    try {
      const releaseId = trade.release_id;
      for (const userId of [trade.buyer_id, trade.seller_id]) {
        this.live.notifyUser(userId, {
          type: 'trade',
          releaseId,
          tradeId: trade.id,
          status: trade.status,
        });
      }
      if (step.paid) {
        this.live.notifyUser(trade[`${step.paid}_id`], { type: 'wallet', releaseId });
        // The Market Report leaves refunded trades out, and ads show completed-trade counts.
        this.live.marketChanged(releaseId);
      }
    } catch (error) {
      console.error('[trades] live update failed:', error);
    }
  }
}
