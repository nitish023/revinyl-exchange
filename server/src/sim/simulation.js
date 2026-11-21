/**
 * An agent-based simulation of one pressing's market (Part 19), run on the real matching
 * engine (OrderBook), to measure what trading strategies do for a market: with and without
 * them, same random seed, same collectors. Spec: docs/parts/part-19-market-makers.md.
 * Tests: simulation.test.js. `npm run simulate` prints the comparison.
 *
 * The world:
 *   - the record's true value drifts like a stock price (geometric Brownian motion); nobody
 *     sees it, not even the bots
 *   - each day a random number of collectors arrive (Poisson). Half want to buy, valuing the
 *     record somewhere around its true value; half have a copy to sell, wanting somewhere
 *     around it. Each places one order a little better for themselves than their value, which
 *     fills if the book has a match and otherwise waits, expiring after ten days
 *   - the market maker (optional) estimates value from the trades it sees (an exponentially
 *     weighted average) and every day quotes a WANTED and a FOR SALE ad around it with
 *     marketMaker.js's rule. Its copies come from what it buys, plus a starting stock
 *   - the mean-reversion trader (optional) keeps a slower average as its fair value and,
 *     every day, acts on how far the last sale strayed from it (meanReversion.js)
 * What's measured: trades, how often and how fast collectors' orders fill, the quoted
 * spread, how far trade prices stray from true value, and each bot's stock and profit.
 */
import { OrderBook } from '../market/orderBook.js';
import { normal, seededRandom } from '../analytics/stats.js';
import { DEFAULT_PARAMS, quote } from './marketMaker.js';
import { REVERSION_PARAMS, reversionOrders } from './meanReversion.js';

const GRADE = 6;
/** Bots trade under ids collectors never get (collectors are 1, 2, 3, ...). */
const MAKER = 0;
const REVERTER = -1;

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

/** A bot's books: what it holds, what it has paid and been paid, its live orders. */
function newAgent({ estimate, sigma, stock, learning }) {
  return {
    estimate,
    sigma,
    last: estimate,
    learning,
    stock,
    startingStock: stock,
    maxStock: stock,
    cashCents: 0,
    trades: 0,
    orderIds: new Set(),
  };
}

/**
 * @param {{ days?: number, seed?: number, marketMaker?: boolean, meanReverter?: boolean,
 *   startCents?: number, dailyVolatility?: number, arrivalsPerDay?: number,
 *   valuationSpread?: number, orderLifeDays?: number, startingStock?: number,
 *   params?: typeof DEFAULT_PARAMS, reversionParams?: typeof REVERSION_PARAMS }} [options]
 */
export function simulateMarket({
  days = 120,
  seed = 1,
  marketMaker = true,
  meanReverter = false,
  startCents = 4000,
  dailyVolatility = 0.02,
  arrivalsPerDay = 4,
  valuationSpread = 0.15,
  orderLifeDays = 10,
  startingStock = 2,
  params = DEFAULT_PARAMS,
  reversionParams = REVERSION_PARAMS,
} = {}) {
  const random = seededRandom(seed);
  const book = new OrderBook(1);
  let value = startCents;
  let nextId = 1;
  let clock = 0;
  const placedOn = new Map(); // a collector's order id -> the day it was placed
  const trades = [];
  const daily = [];
  const spreads = [];
  let placed = 0;
  let filled = 0;
  let daysToFill = 0;

  const agents = new Map();
  if (marketMaker) {
    agents.set(
      MAKER,
      newAgent({
        estimate: startCents,
        sigma: valuationSpread,
        stock: startingStock,
        learning: 0.2,
      }),
    );
  }
  if (meanReverter) {
    // A slow average: a single odd sale barely moves what it thinks the record is worth.
    agents.set(
      REVERTER,
      newAgent({ estimate: startCents, sigma: valuationSpread, stock: 0, learning: 0.05 }),
    );
  }
  const isCollector = (userId) => userId > 0;

  const submit = (order) => {
    const result = book.match(order);
    if (result.trade) {
      const restingId = order.side === 'bid' ? result.trade.askOrderId : result.trade.bidOrderId;
      const { priceCents, buyerId, sellerId } = result.trade;
      trades.push({ day: daily.length, priceCents, value, buyerId, sellerId });
      // A collector's resting order that filled: how long it waited.
      if (placedOn.has(restingId)) {
        filled += 1;
        daysToFill += daily.length - placedOn.get(restingId);
        placedOn.delete(restingId);
      }
      if (isCollector(order.userId)) filled += 1; // filled the moment it arrived
      for (const [userId, sign] of [
        [buyerId, 1],
        [sellerId, -1],
      ]) {
        const agent = agents.get(userId);
        if (!agent) continue;
        agent.stock += sign;
        agent.cashCents -= sign * priceCents;
        agent.trades += 1;
        agent.maxStock = Math.max(agent.maxStock, agent.stock);
        agent.orderIds.delete(order.id);
        agent.orderIds.delete(restingId);
      }
      // Every bot learns from every trade it sees: the price level, and the scatter.
      for (const agent of agents.values()) {
        const surprise = Math.log(priceCents / agent.estimate);
        agent.sigma = Math.sqrt(0.9 * agent.sigma ** 2 + 0.1 * surprise ** 2);
        agent.estimate = Math.round(agent.estimate * Math.exp(agent.learning * surprise));
        agent.last = priceCents;
      }
    } else if (result.rests && isCollector(order.userId)) {
      placedOn.set(order.id, daily.length);
    }
    book.apply(order, result);
  };

  /** A bot replaces yesterday's orders with today's. */
  const requote = (userId, { bidCents, askCents }) => {
    const agent = agents.get(userId);
    for (const id of agent.orderIds) book.remove(id);
    agent.orderIds.clear();
    if (bidCents !== null) {
      clock += 1;
      const bid = {
        id: nextId++,
        userId,
        side: 'bid',
        priceCents: bidCents,
        createdAt: clock,
        minGrade: GRADE,
      };
      agent.orderIds.add(bid.id);
      submit(bid);
    }
    if (askCents !== null && agent.stock > 0) {
      clock += 1;
      const id = nextId++;
      const ask = {
        id,
        userId,
        side: 'ask',
        priceCents: askCents,
        createdAt: clock,
        copyId: id,
        grade: GRADE,
      };
      agent.orderIds.add(id);
      submit(ask);
    }
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

    const maker = agents.get(MAKER);
    if (maker) {
      const q = quote(
        { fairCents: maker.estimate, sigma: maker.sigma, inventory: maker.stock },
        params,
      );
      requote(MAKER, q);
    }
    const reverter = agents.get(REVERTER);
    if (reverter) {
      requote(
        REVERTER,
        reversionOrders(
          {
            fairCents: reverter.estimate,
            lastCents: reverter.last,
            sigma: reverter.sigma,
            stock: reverter.stock,
          },
          reversionParams,
        ),
      );
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
    if (bestAsk && bestBid) {
      spreads.push((bestAsk.priceCents - bestBid.priceCents) / bestAsk.priceCents);
    }
    const todays = trades.filter((t) => t.day === day);
    daily.push({
      day,
      valueCents: Math.round(value),
      closeCents: todays.at(-1)?.priceCents ?? null,
    });
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  /** What a bot's trading made, marked at the true value at the end. */
  const report = (agent) =>
    agent && {
      trades: agent.trades,
      stock: agent.stock,
      maxStock: agent.maxStock,
      profitCents: Math.round(agent.cashCents + (agent.stock - agent.startingStock) * value),
    };
  return {
    trades,
    daily,
    metrics: {
      trades: trades.length,
      fillRate: placed ? filled / placed : null,
      meanDaysToFill: filled ? daysToFill / filled : null,
      meanSpread: mean(spreads),
      trackingError: mean(trades.map((t) => Math.abs(Math.log(t.priceCents / t.value)))),
      maker: report(agents.get(MAKER)) ?? null,
      reverter: report(agents.get(REVERTER)) ?? null,
    },
  };
}
