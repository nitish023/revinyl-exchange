/**
 * The market-making bots (Part 19). Spec: docs/parts/part-19-market-makers.md.
 * Tests: server/test/bots.int.test.js. The quoting rule is server/src/sim/marketMaker.js,
 * the same one the simulation (`npm run simulate`) shows narrows spreads.
 *
 * A bot is an ordinary user flagged is_bot: it has a wallet, places and cancels orders
 * through the order service and steps trades through the trade service, so every rule of
 * the exchange applies to it exactly as to anyone. Every tick (30 seconds) each bot:
 *   1. does its chores: ships what it sold, accepts what it bought once it's shipped
 *   2. makes markets: on each pressing with recent sales (shared out between the bots),
 *      for the grade that sells most, keeps one WANTED ad and one FOR SALE ad at the
 *      quotes marketMaker.js gives for the pressing's fair value (Part 13), its spread, and
 *      the bot's stock of that grade. An ad is replaced only when its quote has moved more
 *      than 3%, so the book isn't churned for nothing.
 *   3. the mean-reversion trader (desk_sato) watches the same pressings and acts on big
 *      moves (meanReversion.js): bids just over a sale well under fair value, asks just under
 *      a sale well over it, and offers what it bought at fair value once prices settle.
 * A market maker starts each pressing with two copies of stock, like a dealer opening a
 * bin; the mean-reversion trader only holds what it has bought.
 */
import { randomBytes } from 'node:crypto';
import { formatCents } from '../../../shared/index.js';
import { hashPassword } from '../auth/passwords.js';
import { AppError } from '../errors.js';
import { quote } from '../sim/marketMaker.js';
import { reversionOrders } from '../sim/meanReversion.js';

/** Two market makers share out the pressings; one mean-reversion trader watches them all. */
export const MAKER_BOTS = Object.freeze(['desk_marlowe', 'desk_okafor']);
export const REVERSION_BOT = 'desk_sato';
export const BOT_NAMES = Object.freeze([...MAKER_BOTS, REVERSION_BOT]);
const MAX_PRESSINGS = 12;
const STARTING_STOCK = 2;
/** Replace an ad only when its quote has moved by more than this share. */
const REQUOTE_SHARE = 0.03;
const TICK_MS = 30_000;

export class BotService {
  #timer = null;
  #running = false;

  /**
   * @param {{ pool: import('pg').Pool, orders: import('../orders/orderService.js').OrderService,
   *   trades: import('../trades/tradeService.js').TradeService,
   *   pricing: import('../analytics/pricingService.js').PricingService }} deps
   */
  constructor({ pool, orders, trades, pricing }) {
    this.pool = pool;
    this.orders = orders;
    this.trades = trades;
    this.pricing = pricing;
  }

  /** The bots' users, made the first time. Their passwords are random and thrown away. */
  async ensureBots() {
    const bots = [];
    for (const name of BOT_NAMES) {
      const { rows } = await this.pool.query(
        `INSERT INTO users (email, display_name, password_hash, is_bot)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (email) DO UPDATE SET is_bot = true
         RETURNING id, display_name`,
        [`${name}@bots.revinyl.local`, name, await hashPassword(randomBytes(24).toString('hex'))],
      );
      bots.push({ id: rows[0].id, name: rows[0].display_name });
    }
    return bots;
  }

  /** Run a tick every 30 seconds (never two at once). */
  start(intervalMs = TICK_MS) {
    this.#timer = setInterval(() => void this.tick(), intervalMs);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
  }

  /**
   * One round for every bot. A failure is logged, never thrown: bots must never take the
   * server down.
   * @returns {Promise<{ chores: number, quotes: number } | null>} null if a tick was running
   */
  async tick() {
    if (this.#running) return null;
    this.#running = true;
    try {
      const bots = await this.ensureBots();
      let chores = 0;
      for (const bot of bots) chores += await this.#doChores(bot);
      const pressings = await this.#pressingsToMake();
      const makers = bots.filter((bot) => MAKER_BOTS.includes(bot.name));
      const reverter = bots.find((bot) => bot.name === REVERSION_BOT);
      let quotes = 0;
      for (const [i, pressing] of pressings.entries()) {
        quotes += await this.#makeMarket(makers[i % makers.length], pressing);
        quotes += await this.#revert(reverter, pressing);
      }
      return { chores, quotes };
    } catch (error) {
      console.error('[bots] tick failed:', error);
      return { chores: 0, quotes: 0 };
    } finally {
      this.#running = false;
    }
  }

  /** Ship what the bot sold; accept what it bought once shipped. */
  async #doChores(bot) {
    const { rows } = await this.pool.query(
      `SELECT id, status, seller_id FROM trades
        WHERE (seller_id = $1 AND status = 'awaiting_shipment')
           OR (buyer_id = $1 AND status = 'shipped')
        ORDER BY id`,
      [bot.id],
    );
    for (const trade of rows) {
      const step = trade.seller_id === bot.id ? 'ship' : 'received';
      await ignoreRefusals(() => this.trades[step](bot, trade.id));
    }
    return rows.length;
  }

  /** Pressings with recent clean sales, busiest first, and the grade that sells most. */
  async #pressingsToMake() {
    const { rows } = await this.pool.query(
      `SELECT release_id, mode() WITHIN GROUP (ORDER BY grade) AS grade, count(*) AS sales
         FROM trades
        WHERE status <> 'refunded' AND created_at > now() - interval '90 days'
        GROUP BY release_id
        ORDER BY count(*) DESC, release_id
        LIMIT $1`,
      [MAX_PRESSINGS],
    );
    if (rows.length === 0) return [];
    const fits = await this.pricing.fairValues(rows.map((row) => row.release_id));
    return rows
      .map((row) => ({
        releaseId: row.release_id,
        grade: row.grade,
        fit: fits.get(row.release_id),
      }))
      .filter((pressing) => pressing.fit);
  }

  /** The bot's copies of a pressing's grade that it could sell. */
  async #stock(bot, releaseId, grade) {
    const { rows } = await this.pool.query(
      `SELECT id, status FROM copies
        WHERE owner_id = $1 AND release_id = $2 AND grade = $3 AND removed_at IS NULL
          AND status IN ('in_crate', 'listed')
        ORDER BY id`,
      [bot.id, releaseId, grade],
    );
    return rows;
  }

  /** A market maker keeps its two ads at its quotes. Returns how many ads it placed. */
  async #makeMarket(bot, { releaseId, grade, fit }) {
    await this.#stockUp(bot, releaseId, grade);
    const copies = await this.#stock(bot, releaseId, grade);
    const fairCents = fit.grades[grade - 1].fairCents;
    const q = quote({ fairCents, sigma: fit.sigma, inventory: copies.length });
    return this.#keepAds(bot, { releaseId, grade, copies }, q);
  }

  /**
   * The mean-reversion trader acts on how far the pressing's last sale (restated to this
   * grade) strayed from fair value: buy a dip, sell a spike, or offer stock at fair value.
   */
  async #revert(bot, { releaseId, grade, fit }) {
    const { rows } = await this.pool.query(
      `SELECT grade, price_cents FROM trades
        WHERE release_id = $1 AND status <> 'refunded' ORDER BY created_at DESC, id DESC LIMIT 1`,
      [releaseId],
    );
    if (rows.length === 0) return 0;
    const lastCents = rows[0].price_cents * Math.exp(fit.gradeStep * (grade - rows[0].grade));
    const copies = await this.#stock(bot, releaseId, grade);
    const orders = reversionOrders({
      fairCents: fit.grades[grade - 1].fairCents,
      lastCents,
      sigma: fit.sigma,
      stock: copies.length,
    });
    return this.#keepAds(bot, { releaseId, grade, copies }, orders);
  }

  /**
   * Keep the bot's ads on a pressing's grade at the prices wanted: an ad within 3% stays,
   * any other is cancelled, a missing one is placed (an ask only with a copy to sell), and
   * a side the strategy doesn't want (null) has its ads taken down.
   * @returns {Promise<number>} how many ads it placed
   */
  async #keepAds(bot, { releaseId, grade, copies }, { bidCents, askCents }) {
    const { rows: open } = await this.pool.query(
      `SELECT o.id, o.side, o.price_cents FROM orders o LEFT JOIN copies c ON c.id = o.copy_id
        WHERE o.user_id = $1 AND o.release_id = $2 AND o.status = 'open'
          AND (o.min_grade = $3 OR c.grade = $3)`,
      [bot.id, releaseId, grade],
    );
    let placed = 0;
    for (const [side, wanted] of [
      ['bid', bidCents],
      ['ask', askCents],
    ]) {
      const current = open.filter((order) => order.side === side);
      const keep =
        wanted === null
          ? null
          : current.find((order) => Math.abs(order.price_cents - wanted) / wanted <= REQUOTE_SHARE);
      for (const order of current) {
        if (order !== keep) await ignoreRefusals(() => this.orders.cancel(bot, order.id));
      }
      if (keep || wanted === null) continue;
      const price = formatCents(wanted);
      if (side === 'bid') {
        await ignoreRefusals(() =>
          this.orders.place(bot, {
            side: 'bid',
            releaseId,
            price,
            minGrade: grade,
            expiresInDays: 7,
          }),
        );
        placed += 1;
      } else {
        const copy = copies.find((candidate) => candidate.status === 'in_crate');
        if (!copy) continue; // nothing to sell yet
        await ignoreRefusals(() =>
          this.orders.place(bot, { side: 'ask', copyId: copy.id, price, expiresInDays: 7 }),
        );
        placed += 1;
      }
    }
    return placed;
  }

  /** The first time a bot makes a market in a pressing, it opens a bin of two copies. */
  async #stockUp(bot, releaseId, grade) {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM copies WHERE owner_id = $1 AND release_id = $2 LIMIT 1',
      [bot.id, releaseId],
    );
    if (rows.length > 0) return;
    await this.pool.query(
      `INSERT INTO copies (owner_id, release_id, grade, sleeve_grade, headline)
       SELECT $1, $2, $3, $3, 'From the market maker''s stock' FROM generate_series(1, $4)`,
      [bot.id, releaseId, grade, STARTING_STOCK],
    );
  }
}

/** A refusal (someone got there first, no cash for that bid) is part of trading. */
async function ignoreRefusals(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}
