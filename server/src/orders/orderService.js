/**
 * Placing and cancelling orders (Part 3). Spec: docs/parts/part-3-crate-and-orders.md.
 * Tests: server/test/orders.int.test.js.
 *
 * The one rule that keeps the exchange correct: match, then save, then apply.
 *   1. book.match(order)                    decides, changes nothing
 *   2. one database transaction             order row, trade row, wallet, copy status
 *   3. book.apply(order, result)            only after COMMIT succeeds
 *   4. ctx.live.marketChanged(releaseId)    and notifyUser(...) for the people involved
 * Orders for the same pressing run one at a time (a queue per release id), so two people
 * can't both take the same copy. Different pressings run in parallel.
 *
 * Locks: a transaction locks at most one wallet (users row) and one copy. A bid locks the
 * buyer's wallet, then the copy it buys; an ask locks its copy, then the buyer's wallet.
 * Those two can only wait on each other for the same copy, which means the same pressing,
 * and the queue never runs two of those at once, so they can't deadlock. Two bids from one
 * person on different pressings take turns on that person's wallet, so the same dollars
 * can't back two orders.
 */
import { formatCents, placeOrderSchema } from '../../../shared/index.js';
import { withTransaction } from '../db/pool.js';
import { AppError, notFound } from '../errors.js';
import { OrderBook } from '../market/orderBook.js';
import { KeyedSerialQueue } from './keyedSerialQueue.js';
import { loadOpenOrders, toEngineOrder, toPlacedOrder, toTradeView } from './orderRows.js';

/**
 * @typedef {object} PlacedOrder what the API sends back (prices as "40.50" strings)
 * @property {number} id
 * @property {number} releaseId
 * @property {'bid' | 'ask'} side
 * @property {string} price
 * @property {number} [minGrade]
 * @property {number} [copyId]
 * @property {string} note
 * @property {'open' | 'filled' | 'cancelled'} status
 * @property {string} createdAt ISO date
 * @property {string | null} closedAt
 */

const copyNotAvailable = () =>
  new AppError(
    409,
    'COPY_NOT_AVAILABLE',
    'That copy is already listed or in a trade. Only copies in your crate can be listed.',
  );

function insufficientFunds(spendableCents, neededCents) {
  const message = `This ad needs $${formatCents(neededCents)} held, and you have $${formatCents(spendableCents)} to spend.`;
  return new AppError(400, 'INSUFFICIENT_FUNDS', message, { price: message });
}

export class OrderService {
  /** @type {Map<number, OrderBook>} one book per pressing, loaded from the database on first use */
  books = new Map();
  /** @type {Map<number, Promise<OrderBook>>} books being loaded right now */
  #loading = new Map();
  #queue = new KeyedSerialQueue();

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
   * The book for a pressing. The first time, load its open orders from the database.
   * @param {number} releaseId
   * @returns {Promise<OrderBook>}
   */
  async book(releaseId) {
    const cached = this.books.get(releaseId);
    if (cached) return cached;
    let loading = this.#loading.get(releaseId);
    if (!loading) {
      loading = (async () => {
        const book = new OrderBook(releaseId);
        for (const order of await loadOpenOrders(this.pool, releaseId)) book.add(order);
        this.books.set(releaseId, book);
        return book;
      })().finally(() => this.#loading.delete(releaseId));
      this.#loading.set(releaseId, loading);
    }
    return loading;
  }

  /**
   * Place a bid (WANTED ad) or an ask (FOR SALE ad).
   * Bid: holds the price from the user's spendable cash, or fails with INSUFFICIENT_FUNDS.
   * Ask: the copy must be the user's and in their crate; it becomes `listed`.
   * If it matches, it fills at the resting order's price and a trade is created
   * (status awaiting_shipment, the copy becomes `in_trade`).
   * @param {{ id: number }} user
   * @param {unknown} input the request body, checked here
   * @returns {Promise<{ order: PlacedOrder, trade: object | null }>}
   */
  async place(user, input) {
    const request = placeOrderSchema.parse(input ?? {});
    let releaseId;
    if (request.side === 'bid') {
      await this.catalog.ensureRelease(request.releaseId); // 404 for a non-vinyl release
      releaseId = request.releaseId;
    } else {
      releaseId = await this.#releaseOfMyCopy(user.id, request.copyId);
    }
    return this.#queue.run(releaseId, () => this.#placeInQueue(user, request, releaseId));
  }

  /**
   * Cancel one of the user's open orders. A bid gives its held cash back; an ask puts the
   * copy back in the crate.
   * @param {{ id: number }} user
   * @param {number} orderId
   * @returns {Promise<PlacedOrder>}
   */
  async cancel(user, orderId) {
    const { rows } = await this.pool.query('SELECT release_id, user_id FROM orders WHERE id = $1', [
      orderId,
    ]);
    // Someone else's order is "not found", so ids can't be used to probe other people's ads.
    if (rows.length === 0 || rows[0].user_id !== user.id) throw notFound('Order');
    const releaseId = rows[0].release_id;
    return this.#queue.run(releaseId, () => this.#cancelInQueue(user, orderId, releaseId));
  }

  async #releaseOfMyCopy(userId, copyId) {
    const { rows } = await this.pool.query(
      'SELECT release_id FROM copies WHERE id = $1 AND owner_id = $2 AND removed_at IS NULL',
      [copyId, userId],
    );
    if (rows.length === 0) throw notFound('Copy');
    return rows[0].release_id;
  }

  async #placeInQueue(user, request, releaseId) {
    const book = await this.book(releaseId);
    const saved = await this.#transaction(releaseId, async (client) => {
      const order =
        request.side === 'bid'
          ? await insertBid(client, user.id, request)
          : await insertAsk(client, user.id, request);
      const result = book.match(order.engine);
      const trade = result.trade
        ? await recordTrade(client, order.engine, result.trade, releaseId)
        : await rest(client, order.engine);
      const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [order.engine.id]);
      return { engine: order.engine, result, row: rows[0], trade };
    });

    this.#updateBook(book, (b) => b.apply(saved.engine, saved.result));
    this.#announce(releaseId, (live) => {
      live.notifyUser(user.id, {
        type: 'order',
        releaseId,
        orderId: saved.row.id,
        status: saved.row.status,
      });
      if (saved.trade) {
        const { buyer_id: buyerId, seller_id: sellerId } = saved.trade;
        const restingId =
          saved.engine.side === 'bid' ? saved.trade.ask_order_id : saved.trade.bid_order_id;
        const restingOwner = saved.engine.side === 'bid' ? sellerId : buyerId;
        live.notifyUser(restingOwner, {
          type: 'order',
          releaseId,
          orderId: restingId,
          status: 'filled',
        });
        for (const userId of [buyerId, sellerId]) {
          live.notifyUser(userId, { type: 'trade', releaseId, tradeId: saved.trade.id });
        }
        live.notifyUser(buyerId, { type: 'wallet', releaseId });
      } else if (saved.engine.side === 'bid') {
        live.notifyUser(user.id, { type: 'wallet', releaseId });
      }
    });

    return {
      order: toPlacedOrder(saved.row),
      trade: saved.trade ? toTradeView(saved.trade, user.id) : null,
    };
  }

  async #cancelInQueue(user, orderId, releaseId) {
    const book = await this.book(releaseId);
    const row = await this.#transaction(releaseId, async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [orderId, user.id],
      );
      if (rows[0].status !== 'open') {
        throw new AppError(
          409,
          'ORDER_NOT_OPEN',
          'That order has already been filled or cancelled.',
        );
      }
      const { rows: cancelled } = await client.query(
        `UPDATE orders SET status = 'cancelled', closed_at = now() WHERE id = $1 RETURNING *`,
        [orderId],
      );
      if (rows[0].side === 'bid') {
        await client.query('UPDATE users SET held_cents = held_cents - $2 WHERE id = $1', [
          user.id,
          rows[0].price_cents,
        ]);
      } else {
        await client.query(`UPDATE copies SET status = 'in_crate' WHERE id = $1`, [
          rows[0].copy_id,
        ]);
      }
      return cancelled[0];
    });

    this.#updateBook(book, (b) => b.remove(orderId));
    this.#announce(releaseId, (live) => {
      live.notifyUser(user.id, { type: 'order', releaseId, orderId, status: 'cancelled' });
      if (row.side === 'bid') live.notifyUser(user.id, { type: 'wallet', releaseId });
    });
    return toPlacedOrder(row);
  }

  /**
   * Run `work` in a transaction for one pressing. A refusal (AppError: no money, not your
   * copy) leaves everything as it was. Any other failure may mean the cached book no longer
   * matches the database (the trade write found the resting order already closed, say), so
   * the book is dropped and the next order reloads it. The transaction rolled back, so the
   * database is still right either way.
   */
  async #transaction(releaseId, work) {
    try {
      return await withTransaction(this.pool, work);
    } catch (error) {
      if (!(error instanceof AppError)) this.books.delete(releaseId);
      throw error;
    }
  }

  /**
   * Update the book after COMMIT. The database is the truth by now, so if the book
   * disagrees (it throws), drop it: the next order for this pressing reloads it.
   */
  #updateBook(book, change) {
    try {
      change(book);
    } catch (error) {
      console.error(`[orders] book ${book.releaseId} disagreed with the database:`, error);
      this.books.delete(book.releaseId);
    }
  }

  /** Tell browsers. The order is already saved, so a live-update failure must not fail it. */
  #announce(releaseId, notifyPeople) {
    try {
      this.live.marketChanged(releaseId);
      notifyPeople(this.live);
    } catch (error) {
      console.error('[orders] live update failed:', error);
    }
  }
}

/** Lock the buyer's wallet, check they can cover the bid, and insert it. */
async function insertBid(client, userId, request) {
  const { rows: wallets } = await client.query(
    'SELECT cash_cents, held_cents FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  const spendable = wallets[0].cash_cents - wallets[0].held_cents;
  // Even a bid that will fill for less must be covered in full, as if it rests.
  if (spendable < request.price) throw insufficientFunds(spendable, request.price);
  const { rows } = await client.query(
    `INSERT INTO orders (user_id, release_id, side, price_cents, min_grade, note)
     VALUES ($1, $2, 'bid', $3, $4, $5) RETURNING *`,
    [userId, request.releaseId, request.price, request.minGrade, request.note],
  );
  return { engine: toEngineOrder(rows[0]) };
}

/** Lock the seller's copy, check it's in their crate, and insert the ask. */
async function insertAsk(client, userId, request) {
  const { rows: copies } = await client.query(
    `SELECT id, release_id, grade, status FROM copies
      WHERE id = $1 AND owner_id = $2 AND removed_at IS NULL FOR UPDATE`,
    [request.copyId, userId],
  );
  if (copies.length === 0) throw notFound('Copy');
  if (copies[0].status !== 'in_crate') throw copyNotAvailable();
  const { rows } = await client.query(
    `INSERT INTO orders (user_id, release_id, side, price_cents, copy_id)
     VALUES ($1, $2, 'ask', $3, $4) RETURNING *`,
    [userId, copies[0].release_id, request.price, request.copyId],
  );
  return { engine: toEngineOrder(rows[0], copies[0].grade) };
}

/** No match: hold the bid's price, or list the ask's copy. */
async function rest(client, order) {
  if (order.side === 'bid') {
    await client.query('UPDATE users SET held_cents = held_cents + $2 WHERE id = $1', [
      order.userId,
      order.priceCents,
    ]);
  } else {
    await client.query(`UPDATE copies SET status = 'listed' WHERE id = $1`, [order.copyId]);
  }
  return null;
}

/**
 * A match: close both orders, write the trade, take the price from the buyer and lock the
 * copy in the trade. The seller is paid in Part 5, when the buyer has checked the record.
 * @returns {Promise<object>} the `trades` row
 */
async function recordTrade(client, incoming, trade, releaseId) {
  const restingId = incoming.side === 'bid' ? trade.askOrderId : trade.bidOrderId;
  const { rowCount } = await client.query(
    `UPDATE orders SET status = 'filled', closed_at = now()
      WHERE id = ANY($1::bigint[]) AND status = 'open'`,
    [[incoming.id, restingId]],
  );
  // The book thought the resting order was open; the database says otherwise. Roll back.
  if (rowCount !== 2) throw new Error(`Order ${restingId} is in the book but not open`);

  const { rows } = await client.query(
    `INSERT INTO trades (release_id, copy_id, grade, price_cents, bid_order_id, ask_order_id,
                         buyer_id, seller_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      releaseId,
      trade.copyId,
      trade.grade,
      trade.priceCents,
      trade.bidOrderId,
      trade.askOrderId,
      trade.buyerId,
      trade.sellerId,
    ],
  );

  // A resting bid was holding its price, and a trade against it happens at exactly that
  // price, so the hold and the payment are the same amount. An incoming bid held nothing.
  const releasedHold = incoming.side === 'ask' ? trade.priceCents : 0;
  await client.query(
    `UPDATE users SET held_cents = held_cents - $2, cash_cents = cash_cents - $3 WHERE id = $1`,
    [trade.buyerId, releasedHold, trade.priceCents],
  );
  const { rowCount: copies } = await client.query(
    `UPDATE copies SET status = 'in_trade'
      WHERE id = $1 AND status IN ('in_crate', 'listed') AND removed_at IS NULL`,
    [trade.copyId],
  );
  if (copies !== 1) throw new Error(`Copy ${trade.copyId} can't go into a trade`);
  return rows[0];
}
