/**
 * Fair value and the chance of selling, for a pressing (Part 13). Spec:
 * docs/parts/part-13-fair-value.md. Reads sales and past ads, and fits the models in
 * fairValue.js and saleOdds.js.
 *
 * Two things are learned from the whole market and kept for a minute, since they move
 * slowly and take one pass over every sale and ad: the grade premium (the prior for every
 * pressing's own fit) and the time-to-sale model. A pressing's own fair value is fitted on
 * each request: it's one small query and a 2x2 solve.
 */
import { formatCents, gradeByRank } from '../../../shared/index.js';
import { fitFairValue, HALF_LIFE_DAYS, pooledGradeStep } from './fairValue.js';
import { dailyCandles, depthByGrade, priceStats } from './history.js';
import { findWashTrades, withoutWashTrades } from './surveillance.js';
import { fitSaleOdds } from './saleOdds.js';

/** Sales older than this say nothing useful about today's prices (weight < 0.02%). */
const SALES_WINDOW_DAYS = 365;
const MARKET_TTL_MS = 60_000;
const DAY_MS = 86_400_000;
/** An ad that filled the moment it was placed still counts, as a sale after a minute. */
const MIN_DAYS_UP = 1 / 1440;

/**
 * Every sale in the window that wasn't refunded, by pressing. Part 17: by default, without
 * the trades that look like wash trading (surveillance.js), so no price or model is built
 * from them; `{ clean: false }` keeps them, for the integrity report.
 */
async function loadSales(db, now, releaseId = null, { clean = true } = {}) {
  const { rows } = await db.query(
    `SELECT id, release_id, copy_id, buyer_id, seller_id, grade, price_cents, created_at
       FROM trades
      WHERE status <> 'refunded' AND created_at > $1
        AND ($2::bigint IS NULL OR release_id = $2)
      ORDER BY id`,
    [new Date(now - SALES_WINDOW_DAYS * DAY_MS), releaseId],
  );
  const byRelease = new Map();
  for (const row of rows) {
    const sales = byRelease.get(row.release_id) ?? [];
    sales.push({
      id: row.id,
      copyId: row.copy_id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      grade: row.grade,
      priceCents: row.price_cents,
      at: row.created_at.getTime(),
    });
    byRelease.set(row.release_id, sales);
  }
  if (clean) {
    for (const [id, sales] of byRelease) byRelease.set(id, withoutWashTrades(sales));
  }
  return byRelease;
}

export class PricingService {
  /** @type {{ at: number, value: Promise<{ gradeStep: number, odds: object }> } | null} */
  #market = null;

  /**
   * @param {{ pool: import('pg').Pool, now?: () => number, ttlMs?: number }} deps
   */
  constructor({ pool, now = Date.now, ttlMs = MARKET_TTL_MS }) {
    this.pool = pool;
    this.now = now;
    this.ttlMs = ttlMs;
  }

  /** Forget what was learned from the whole market (tests; a big change in the data). */
  refresh() {
    this.#market = null;
  }

  /**
   * The market-wide grade premium and time-to-sale model, cached for a minute. A failed
   * load isn't cached, so the next request tries again.
   */
  #learnFromMarket() {
    const now = this.now();
    if (this.#market && now - this.#market.at < this.ttlMs) return this.#market.value;
    const value = (async () => {
      const salesByRelease = await loadSales(this.pool, now);
      const gradeStep = pooledGradeStep(salesByRelease);
      // Each pressing's fair value per grade, to measure every past ad against.
      const fairByRelease = new Map();
      for (const [releaseId, sales] of salesByRelease) {
        fairByRelease.set(releaseId, fitFairValue(sales, { now, priorStep: gradeStep }));
      }
      const { rows } = await this.pool.query(
        `SELECT o.release_id, o.price_cents, o.status, o.created_at, o.closed_at, c.grade
           FROM orders o JOIN copies c ON c.id = o.copy_id
          WHERE o.side = 'ask' AND o.target_order_id IS NULL AND o.created_at > $1`,
        [new Date(now - SALES_WINDOW_DAYS * DAY_MS)],
      );
      const ads = [];
      for (const row of rows) {
        const fair = fairByRelease.get(row.release_id);
        if (!fair) continue; // a pressing that never sold has no fair value to compare to
        const end = row.closed_at ? row.closed_at.getTime() : now;
        ads.push({
          x: Math.log(row.price_cents / fair.grades[row.grade - 1].fairCents),
          days: Math.max((end - row.created_at.getTime()) / DAY_MS, MIN_DAYS_UP),
          sold: row.status === 'filled',
        });
      }
      return { gradeStep, odds: fitSaleOdds(ads) };
    })();
    this.#market = { at: now, value };
    value.catch(() => {
      if (this.#market?.value === value) this.#market = null;
    });
    return value;
  }

  /**
   * Part 17: what surveillance set aside for a pressing: trades that look like wash trading
   * (with why), and sales the fair value fit found too far from the rest (outliers). People
   * are never named, as everywhere on the site.
   * @param {number} releaseId
   */
  async integrity(releaseId) {
    const now = this.now();
    const [{ gradeStep }, all] = await Promise.all([
      this.#learnFromMarket(),
      loadSales(this.pool, now, releaseId, { clean: false }),
    ]);
    const sales = all.get(releaseId) ?? [];
    const flags = findWashTrades(sales);
    const clean = sales.filter((sale) => !flags.has(sale.id));
    const fair = fitFairValue(clean, { now, priorStep: gradeStep });
    const describe = (sale) => ({
      tradeId: sale.id,
      grade: sale.grade,
      code: gradeByRank(sale.grade).code,
      price: formatCents(sale.priceCents),
      at: new Date(sale.at).toISOString(),
    });
    return {
      checked: sales.length,
      washTrades: sales
        .filter((sale) => flags.has(sale.id))
        .map((sale) => ({ ...describe(sale), reasons: [...flags.get(sale.id)].sort() })),
      outliers: (fair?.outliers ?? []).map(describe),
    };
  }

  /**
   * A pressing's price history in VG+ terms (daily candles and their stats) and its order
   * book as depth staircases (Part 14), as the API sends them.
   * @param {number} releaseId
   */
  async history(releaseId) {
    const now = this.now();
    const [{ gradeStep: marketStep }, byRelease, book] = await Promise.all([
      this.#learnFromMarket(),
      loadSales(this.pool, now, releaseId),
      this.pool.query(
        `SELECT o.side, o.price_cents, o.min_grade, c.grade
           FROM orders o LEFT JOIN copies c ON c.id = o.copy_id
          WHERE o.release_id = $1 AND o.status = 'open'`,
        [releaseId],
      ),
    ]);
    const sales = byRelease.get(releaseId) ?? [];
    // The pressing's own grade premium where it has sales; the market's where it doesn't.
    const fair = fitFairValue(sales, { now, priorStep: marketStep });
    const gradeStep = fair ? fair.gradeStep : marketStep;
    const candles = dailyCandles(sales, gradeStep);
    const stats = priceStats(candles, now);
    const orders = (side) =>
      book.rows
        .filter((row) => row.side === side)
        .map((row) => ({ priceCents: row.price_cents, minGrade: row.min_grade, grade: row.grade }));
    const books = depthByGrade(orders('bid'), orders('ask'));
    const money = (cents) => (cents === null ? null : formatCents(cents));
    const steps = (list) =>
      list.map((step) => ({ price: formatCents(step.priceCents), copies: step.copies }));
    const toApi = (levels) => ({
      bids: steps(levels.bids),
      asks: steps(levels.asks),
      spread: levels.spread && {
        bid: formatCents(levels.spread.bidCents),
        ask: formatCents(levels.spread.askCents),
        amount: formatCents(levels.spread.cents),
        share: levels.spread.share,
      },
    });
    return {
      candles: candles.map((candle) => ({
        day: candle.day,
        open: formatCents(candle.open),
        high: formatCents(candle.high),
        low: formatCents(candle.low),
        close: formatCents(candle.close),
        sales: candle.sales,
      })),
      stats: {
        monthlyVolatility: stats.monthlyVolatility,
        change30: stats.change30,
        high52: money(stats.high52),
        low52: money(stats.low52),
        lastClose: money(stats.lastClose),
      },
      // One book per grade: for sale at that grade, against the ads that would take it.
      depth: Object.entries(books).map(([grade, levels]) => ({
        grade: Number(grade),
        code: gradeByRank(Number(grade)).code,
        ...toApi(levels),
      })),
    };
  }

  /**
   * A pressing's fair value per grade and the time-to-sale model, as the API sends them.
   * @param {number} releaseId
   */
  async pricing(releaseId) {
    const now = this.now();
    const [{ gradeStep, odds }, byRelease] = await Promise.all([
      this.#learnFromMarket(),
      loadSales(this.pool, now, releaseId),
    ]);
    const fair = fitFairValue(byRelease.get(releaseId) ?? [], { now, priorStep: gradeStep });
    return {
      fairValue: fair && {
        grades: fair.grades.map((row) => ({
          grade: row.grade,
          code: gradeByRank(row.grade).code,
          fair: formatCents(row.fairCents),
          low: formatCents(row.lowCents),
          high: formatCents(row.highCents),
          sales: row.sales,
        })),
        gradeStep: Math.round((Math.exp(fair.gradeStep) - 1) * 1000) / 1000,
        salesUsed: fair.salesUsed,
        outliers: fair.outliers.length,
        halfLifeDays: HALF_LIFE_DAYS,
      },
      odds: { alpha: odds.alpha, beta: odds.beta, ads: odds.ads, sold: odds.sold },
    };
  }
}
