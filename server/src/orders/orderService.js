/**
 * Placing and cancelling orders (Part 3). Spec: docs/parts/part-3-crate-and-orders.md.
 * Tests: server/test/orders.int.test.js (the checklist is there as it.todo).
 *
 * The one rule that keeps the exchange correct: match, then save, then apply.
 *   1. book.match(order)                    decides, changes nothing
 *   2. one database transaction             order row, trade row, wallet, copy status
 *   3. book.apply(order, result)            only after COMMIT succeeds
 *   4. ctx.live.marketChanged(releaseId)    and notifyUser(...) for the people involved
 * Orders for the same pressing run one at a time (a queue per release id), so two people
 * can't both take the same copy. Different pressings run in parallel.
 */
/** @typedef {import('../market/orderBook.js').OrderBook} OrderBook */

/**
 * @typedef {object} PlacedOrder what the API sends back (prices as "40.50" strings)
 * @property {number} id
 * @property {number} releaseId
 * @property {'bid' | 'ask'} side
 * @property {string} price
 * @property {number} [minGrade]
 * @property {number} [copyId]
 * @property {'open' | 'filled' | 'cancelled'} status
 * @property {string} createdAt ISO date
 */

export class OrderService {
  /** @type {Map<number, OrderBook>} one book per pressing, loaded from the database on first use */
  books = new Map();

  /**
   * @param {{ pool: import('pg').Pool, catalog: import('../catalog/catalogService.js').CatalogService,
   *           live: import('../market/live.js').LiveUpdates }} deps
   */
  constructor({ pool, catalog, live }) {
    this.pool = pool;
    this.catalog = catalog;
    this.live = live;
  }

  /**
   * The book for a pressing. The first time, load its open orders from the database with
   * book.add() (asks need the copy's grade from `copies`).
   * @param {number} _releaseId
   * @returns {Promise<OrderBook>}
   */
  async book(_releaseId) {
    throw new Error('Part 3: OrderService.book is not built yet');
  }

  /**
   * Place a bid (WANTED ad) or an ask (FOR SALE ad).
   * Bid: holds the price from the user's spendable cash, or fails with INSUFFICIENT_FUNDS.
   * Ask: the copy must be the user's and in their crate; it becomes `listed`.
   * If it matches, it fills at the resting order's price and a trade is created
   * (status awaiting_shipment, the copy becomes `in_trade`).
   * @param {{ id: number }} _user
   * @param {unknown} _input the request body, checked here
   * @returns {Promise<{ order: PlacedOrder, trade: object | null }>}
   */
  async place(_user, _input) {
    throw new Error('Part 3: OrderService.place is not built yet');
  }

  /**
   * Cancel one of the user's open orders. A bid gives its held cash back; an ask puts the
   * copy back in the crate.
   * @param {{ id: number }} _user
   * @param {number} _orderId
   * @returns {Promise<PlacedOrder>}
   */
  async cancel(_user, _orderId) {
    throw new Error('Part 3: OrderService.cancel is not built yet');
  }
}
