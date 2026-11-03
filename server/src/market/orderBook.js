/**
 * The matching engine for one pressing.
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
import { meetsMinimumGrade } from '../../../shared/grades.js';

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

const WHOLE_NUMBER_FIELDS = {
  bid: ['id', 'userId', 'priceCents', 'createdAt', 'minGrade'],
  ask: ['id', 'userId', 'priceCents', 'createdAt', 'copyId', 'grade'],
};

/** A database row uses null for "no target"; an order made in code leaves the field out. */
const isTargeted = (order) => order.targetOrderId !== undefined && order.targetOrderId !== null;

/**
 * Catches a mistake in our own code, so it throws rather than returning a message for users.
 * pg returns bigint columns as strings, and every rule here would quietly go wrong with
 * them: '1' === 1 is false, so a self-trade would slip through, and '9000' <= '10000' is
 * false because strings compare letter by letter. Limits like the price range are
 * validateOrder's job (shared/orders.js).
 */
function assertWellFormed(order) {
  const fields = WHOLE_NUMBER_FIELDS[order.side];
  if (!fields) throw new TypeError(`Order ${order.id}: side must be 'bid' or 'ask'`);
  for (const field of fields) {
    if (!Number.isSafeInteger(order[field])) {
      throw new TypeError(`Order ${order.id}: ${field} must be a whole number`);
    }
  }
  if (isTargeted(order) && !Number.isSafeInteger(order.targetOrderId)) {
    throw new TypeError(`Order ${order.id}: targetOrderId must be a whole number`);
  }
}

const earliestFirst = (a, b) => a.createdAt - b.createdAt || a.id - b.id;
const cheapestFirst = (a, b) => a.priceCents - b.priceCents || earliestFirst(a, b);
const highestFirst = (a, b) => b.priceCents - a.priceCents || earliestFirst(a, b);

/** Matching rules 1, 2 and 5: opposite sides, different users, prices cross, grade is good enough. */
function canTrade(incoming, resting) {
  const [bid, ask] = incoming.side === 'bid' ? [incoming, resting] : [resting, incoming];
  return (
    incoming.side !== resting.side &&
    bid.userId !== ask.userId &&
    ask.priceCents <= bid.priceCents &&
    meetsMinimumGrade(ask.grade, bid.minGrade)
  );
}

/** @returns {Trade} */
function toTrade(incoming, resting) {
  const [bid, ask] = incoming.side === 'bid' ? [incoming, resting] : [resting, incoming];
  return {
    bidOrderId: bid.id,
    askOrderId: ask.id,
    buyerId: bid.userId,
    sellerId: ask.userId,
    copyId: ask.copyId,
    grade: ask.grade,
    priceCents: resting.priceCents,
  };
}

export class OrderBook {
  /**
   * Every resting order by id, on both sides. Sorting when asked keeps this simple, with no
   * sorted list to keep correct: a pressing's book only ever holds a handful of orders.
   * Orders are frozen copies, so code outside the book can't change them by accident.
   * @type {Map<number, Readonly<Order>>}
   */
  #orders = new Map();

  /** @param {number} releaseId */
  constructor(releaseId) {
    this.releaseId = releaseId;
  }

  /** Put an order in the book without matching (used to rebuild from the database). */
  add(order) {
    this.#assertCanEnter(order);
    if (isTargeted(order)) throw new Error(`Order ${order.id}: a targeted order never rests`);
    this.#orders.set(order.id, Object.freeze({ ...order }));
  }

  /** Remove a resting order (cancel). Returns the removed order, or null if it wasn't there. */
  remove(orderId) {
    const order = this.#orders.get(orderId) ?? null;
    this.#orders.delete(orderId);
    return order;
  }

  /**
   * Decide what an incoming order would do. Must not change the book.
   * @param {Order} incoming
   * @returns {MatchResult}
   */
  match(incoming) {
    this.#assertCanEnter(incoming);
    if (isTargeted(incoming)) {
      const target = this.#orders.get(incoming.targetOrderId);
      return target && canTrade(incoming, target)
        ? { trade: toTrade(incoming, target), rests: false }
        : { trade: null, rests: false, rejected: 'TARGET_UNAVAILABLE' };
    }
    const [best] = (incoming.side === 'bid' ? this.asks() : this.bids()).filter((resting) =>
      canTrade(incoming, resting),
    );
    return best ? { trade: toTrade(incoming, best), rests: false } : { trade: null, rests: true };
  }

  /**
   * Make a match result real: remove the filled resting order, or rest the incoming one.
   * Throws if the resting order has gone, which means the book and the database disagree
   * (Part 7 handles that by rebuilding the book from the database).
   * @param {Order} incoming
   * @param {MatchResult} result
   */
  apply(incoming, result) {
    if (result.trade) {
      const restingId = incoming.side === 'bid' ? result.trade.askOrderId : result.trade.bidOrderId;
      if (!this.#orders.delete(restingId)) {
        throw new Error(`Can't apply trade: resting order ${restingId} is not in the book`);
      }
    } else if (result.rests) {
      this.add(incoming);
    }
  }

  /** Resting asks, cheapest first (price, then time, then id). Part 4 shows these as FOR SALE ads. */
  asks() {
    return this.#side('ask').sort(cheapestFirst);
  }

  /** Resting bids, highest first (price, then time, then id). Part 4 shows these as WANTED ads. */
  bids() {
    return this.#side('bid').sort(highestFirst);
  }

  #side(side) {
    return [...this.#orders.values()].filter((order) => order.side === side);
  }

  /**
   * The checks shared by add() and match(). The database is what really stops a copy being
   * sold twice (a unique index, Part 3); this makes a bug there fail loudly here too.
   */
  #assertCanEnter(order) {
    assertWellFormed(order);
    if (this.#orders.has(order.id)) {
      throw new Error(`Order ${order.id} is already in the book`);
    }
    if (order.side === 'ask' && this.#side('ask').some((ask) => ask.copyId === order.copyId)) {
      throw new Error(`Copy ${order.copyId} already has an open ask`);
    }
  }
}
