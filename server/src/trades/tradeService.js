/**
 * What happens to a trade after the match (Part 5). Spec: docs/parts/part-5-trades.md.
 * Tests: server/test/trades.int.test.js (the checklist is there as it.todo).
 *
 *   awaiting_shipment --ship--> shipped --received--> completed   (seller paid, copy moves to the buyer)
 *          |                       |
 *        cancel (seller)        refund (buyer)
 *          v                       v
 *       refunded               refunded                          (buyer repaid, copy back to the seller)
 *
 * Every change: lock the trade row, check who is asking and the status, change the trade,
 * the wallets and the copy in one transaction, then tell browsers (ctx.live) after COMMIT.
 */

/**
 * @typedef {object} TradeView what the API sends back (prices as "40.50" strings)
 * @property {number} id
 * @property {number} releaseId
 * @property {'buyer' | 'seller'} role
 * @property {'awaiting_shipment' | 'shipped' | 'completed' | 'refunded'} status
 * @property {string} price
 * @property {number} grade
 * @property {string} createdAt ISO date
 */

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
   * @param {{ id: number }} _user
   * @param {number} _tradeId
   * @returns {Promise<TradeView>}
   */
  async ship(_user, _tradeId) {
    throw new Error('Part 5: TradeService.ship is not built yet');
  }

  /**
   * Seller backs out before shipping: awaiting_shipment -> refunded. The buyer gets the
   * price back and the copy returns to the seller's crate.
   */
  async cancel(_user, _tradeId) {
    throw new Error('Part 5: TradeService.cancel is not built yet');
  }

  /**
   * Buyer confirms it arrived as described: shipped -> completed. The seller is paid and the
   * copy becomes the buyer's (owner_id), back to `in_crate`.
   */
  async received(_user, _tradeId) {
    throw new Error('Part 5: TradeService.received is not built yet');
  }

  /**
   * Buyer says it isn't as described: shipped -> refunded. The buyer gets the price back and
   * the copy returns to the seller's crate.
   */
  async refund(_user, _tradeId) {
    throw new Error('Part 5: TradeService.refund is not built yet');
  }

  /**
   * My trades, newest first.
   * @param {{ id: number }} _user
   * @param {{ status?: string }} [_filters]
   * @returns {Promise<TradeView[]>}
   */
  async list(_user, _filters) {
    throw new Error('Part 5: TradeService.list is not built yet');
  }
}
