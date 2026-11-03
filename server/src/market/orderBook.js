/**
 * PART 1 (Sauransh, week 7): the matching engine for one pressing.
 * Spec: docs/parts/part-1-matching-engine.md. Tests: orderBook.test.js.
 *
 * One OrderBook per pressing (Discogs release). Every order is for exactly one
 * copy, so a match produces at most one trade: an incoming order either fills
 * completely against one resting order, or rests in the book.
 *
 * The book never touches the database. Later parts use it like this:
 *   const result = book.match(incoming);   // pure: decides, changes nothing
 *   ...save the order/trade in one database transaction...
 *   book.apply(incoming, result);          // only after the commit succeeds
 * so a failed transaction can't leave memory and the database disagreeing.
 */

/**
 * @typedef {object} Order
 * @property {number} id          unique and increasing (a database sequence later; tests pick them)
 * @property {number} userId
 * @property {'bid' | 'ask'} side bid = WANTED ad (a buyer), ask = FOR SALE ad (one copy)
 * @property {number} priceCents  whole cents: a bid's maximum, or an ask's asking price
 * @property {number} createdAt   milliseconds since 1970, for time priority
 * @property {number} [minGrade]  bids only: lowest grade rank accepted (1 Poor … 8 Mint)
 * @property {number} [copyId]    asks only: the copy being sold
 * @property {number} [grade]     asks only: that copy's grade rank
 * @property {number} [targetOrderId] optional: only match this one resting order
 *   ("Buy this copy" / "Sell to them" in Part 5); never rests if it can't
 */

/**
 * @typedef {object} Trade
 * @property {number} bidOrderId
 * @property {number} askOrderId
 * @property {number} buyerId
 * @property {number} sellerId
 * @property {number} copyId
 * @property {number} grade
 * @property {number} priceCents the resting order's price
 */

/**
 * @typedef {object} MatchResult
 * @property {Trade | null} trade
 * @property {boolean} rests true when the incoming order should be added to the book
 * @property {string} [rejected] 'TARGET_UNAVAILABLE' when a targeted order can't fill
 */

export class OrderBook {
  /** @param {number} releaseId */
  constructor(releaseId) {
    this.releaseId = releaseId;
    // TODO(Part 1): choose how to store resting bids and asks.
  }

  /** Put an order in the book without matching (used to rebuild from the database). */
  add(_order) {
    throw new Error('OrderBook.add is not built yet (Part 1)');
  }

  /** Remove a resting order (cancel). Returns the removed order, or null if it wasn't there. */
  remove(_orderId) {
    throw new Error('OrderBook.remove is not built yet (Part 1)');
  }

  /**
   * Decide what an incoming order would do. Must not change the book.
   * @param {Order} _incoming
   * @returns {MatchResult}
   */
  match(_incoming) {
    throw new Error('OrderBook.match is not built yet (Part 1)');
  }

  /** Make a match result real: remove the filled resting order, or rest the incoming one. */
  apply(_incoming, _result) {
    throw new Error('OrderBook.apply is not built yet (Part 1)');
  }

  /** Resting asks, cheapest first (price, then time, then id). Part 4 shows these as FOR SALE ads. */
  asks() {
    throw new Error('OrderBook.asks is not built yet (Part 1)');
  }

  /** Resting bids, highest first (price, then time, then id). Part 4 shows these as WANTED ads. */
  bids() {
    throw new Error('OrderBook.bids is not built yet (Part 1)');
  }
}
