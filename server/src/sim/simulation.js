/**
 * An agent-based simulation of one pressing's market (Part 19), run on the real matching
 * engine (OrderBook), to measure what a market maker does for a market: with and without
 * one, same random seed, same traders. Spec: docs/parts/part-19-market-makers.md.
 * Tests: simulation.test.js. `npm run simulate` prints the comparison.
 *
 * The world:
 *   - the record's true value drifts like a stock price (geometric Brownian motion); nobody
 *     sees it, not even the market maker
 *   - each day a random number of collectors arrive (Poisson). Half want to buy, valuing the
 *     record somewhere around its true value; half have a copy to sell, wanting somewhere
 *     around it. Each places one order a little better for themselves than their value, which
 *     fills if the book has a match and otherwise waits, expiring after ten days
 *   - the market maker (optional) estimates value from trades it sees (an exponentially
 *     weighted average) and, every day, quotes a WANTED ad and a FOR SALE ad around it with
 *     marketMaker.js's rule. Its copies come from what it buys, plus a starting stock
 * What's measured: trades, how often and how fast collectors' orders fill, the quoted
 * spread, how far trade prices stray from true value, and the maker's inventory and profit.
 */
import { OrderBook } from '../market/orderBook.js';
import { normal, seededRandom } from '../analytics/stats.js';
import { DEFAULT_PARAMS, quote } from './marketMaker.js';

const GRADE = 6;
const MAKER = 0;

/** A Poisson draw (Knuth), fine for the small daily means used here. */
function poisson(random, mean) {
  const limit = Math.exp(-mean);
  let count = 0;
  let product = random();
  while (product > limit) {
    count += 1;
    product *= random();
  }
  return count;
}

/**
 * @param {{ days?: number, seed?: number, marketMaker?: boolean, startCents?: number,
 *   dailyVolatility?: number, arrivalsPerDay?: number, valuationSpread?: number,
 *   orderLifeDays?: number, startingStock?: number, params?: typeof DEFAULT_PARAMS }} [options]
 */
export function simulateMarket({
  days = 120,
  seed = 1,
  marketMaker = true,
  startCents = 4000,
  dailyVolatility = 0.02,
  arrivalsPerDay = 4,
  valuationSpread = 0.15,
  orderLifeDays = 10,
  startingStock = 2,
  params = DEFAULT_PARAMS,
} = {}) {
  const random = seededRandom(seed);
  const book = new OrderBook(1);
  let value = startCents;
  let nextId = 1;
  let clock = 0;
  const placedOn = new Map(); // order id -> day, for collectors' orders
  const trades = [];
  const daily = [];
  const spreads = [];
  let placed = 0;
  let filled = 0;
  let daysToFill = 0;

  const maker = {
    estimate: startCents,
    sigma: valuationSpread,
    stock: startingStock,
    cashCents: 0,
    bidId: null,
    askId: null,
    trades: 0,
    maxStock: startingStock,
  };

  const submit = (order) => {
    const result = book.match(order);
    if (result.trade) {
      const restingId = order.side === 'bid' ? result.trade.askOrderId : result.trade.bidOrderId;
      const { priceCents, buyerId, sellerId } = result.trade;
      trades.push({ day: daily.length, priceCents, value });
      // A collector's resting order that filled: how long it waited.
      if (placedOn.has(restingId)) {
        filled += 1;
        daysToFill += daily.length - placedOn.get(restingId);
        placedOn.delete(restingId);
      }
      if (order.userId !== MAKER) filled += 1; // filled the moment it arrived
      if (buyerId === MAKER) {
        maker.stock += 1;
        maker.cashCents -= priceCents;
        maker.trades += 1;
        maker.bidId = null;
      }
      if (sellerId === MAKER) {
        maker.stock -= 1;
        maker.cashCents += priceCents;
        maker.trades += 1;
        maker.askId = null;
      }
      maker.maxStock = Math.max(maker.maxStock, maker.stock);
      // The maker learns from every trade it sees: price level and how far prices scatter.
      const surprise = Math.log(priceCents / maker.estimate);
      maker.sigma = Math.sqrt(0.9 * maker.sigma ** 2 + 0.1 * surprise ** 2);
      maker.estimate = Math.round(maker.estimate * Math.exp(0.2 * surprise));
    } else if (result.rests && order.userId !== MAKER) {
      placedOn.set(order.id, daily.length);
    }
    book.apply(order, result);
  };

  for (let day = 0; day < days; day += 1) {
    value *= Math.exp(dailyVolatility * normal(random) - dailyVolatility ** 2 / 2);

    // Collectors' orders that have waited too long expire.
    for (const [id, placedDay] of placedOn) {
      if (day - placedDay >= orderLifeDays) {
        book.remove(id);
        placedOn.delete(id);
      }
    }

    if (marketMaker) {
      for (const id of [maker.bidId, maker.askId]) if (id !== null) book.remove(id);
      maker.bidId = null;
      maker.askId = null;
      const q = quote(
        { fairCents: maker.estimate, sigma: maker.sigma, inventory: maker.stock },
        params,
      );
      clock += 1;
      const bid = {
        id: nextId++,
        userId: MAKER,
        side: 'bid',
        priceCents: q.bidCents,
        createdAt: clock,
        minGrade: GRADE,
      };
      maker.bidId = bid.id;
      submit(bid);
      if (maker.stock > 0) {
        clock += 1;
        const askId = nextId++;
        const ask = {
          id: askId,
          userId: MAKER,
          side: 'ask',
          priceCents: q.askCents,
          createdAt: clock,
          copyId: askId,
          grade: GRADE,
        };
        maker.askId = ask.id;
        submit(ask);
      }
    }

    const arrivals = poisson(random, arrivalsPerDay);
    for (let i = 0; i < arrivals; i += 1) {
      const id = nextId++;
      clock += 1;
      const worth = value * Math.exp(valuationSpread * normal(random));
      const greed = 1 + 0.15 * random();
      placed += 1;
      if (random() < 0.5) {
        const priceCents = Math.max(100, Math.round(worth / greed));
        submit({ id, userId: id, side: 'bid', priceCents, createdAt: clock, minGrade: GRADE });
      } else {
        const priceCents = Math.max(100, Math.round(worth * greed));
        submit({
          id,
          userId: id,
          side: 'ask',
          priceCents,
          createdAt: clock,
          copyId: id,
          grade: GRADE,
        });
      }
    }

    const [bestAsk] = book.asks();
    const [bestBid] = book.bids();
    if (bestAsk && bestBid)
      spreads.push((bestAsk.priceCents - bestBid.priceCents) / bestAsk.priceCents);
    const todays = trades.filter((t) => t.day === day);
    daily.push({
      day,
      valueCents: Math.round(value),
      closeCents: todays.at(-1)?.priceCents ?? null,
    });
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  return {
    trades,
    daily,
    metrics: {
      trades: trades.length,
      fillRate: placed ? filled / placed : null,
      meanDaysToFill: filled ? daysToFill / filled : null,
      meanSpread: mean(spreads),
      trackingError: mean(trades.map((t) => Math.abs(Math.log(t.priceCents / t.value)))),
      maker: marketMaker
        ? {
            trades: maker.trades,
            stock: maker.stock,
            maxStock: maker.maxStock,
            // Marked at the true value at the end: what its trading made, all told.
            profitCents: Math.round(maker.cashCents + (maker.stock - startingStock) * value),
          }
        : null,
    },
  };
}
