/**
 * Property-based tests for the matching engine (Part 7). Spec: docs/parts/part-7-recovery.md.
 *
 * Instead of hand-picked examples, fast-check generates thousands of random sequences of
 * orders, cancels and targeted orders, and after every step the real book is compared with
 * a tiny reference model: a plain list of resting orders and a matcher written separately,
 * the slow obvious way. When a property fails, fast-check shrinks the sequence to the
 * shortest one that still fails and prints it, so a failure reads like a hand-written test.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OrderBook } from './orderBook.js';

const RELEASE = 249504;
const TRADERS = 4; // few traders, prices and grades, so orders collide, tie and self-match often

const placeArb = fc.record({
  type: fc.constant('place'),
  side: fc.constantFrom('bid', 'ask'),
  userId: fc.integer({ min: 1, max: TRADERS }),
  dollars: fc.integer({ min: 1, max: 12 }),
  grade: fc.integer({ min: 1, max: 8 }),
  sameMillisecond: fc.boolean(),
});
const commandArb = fc.oneof(
  { arbitrary: placeArb, weight: 6 },
  { arbitrary: fc.record({ type: fc.constant('cancel'), pick: fc.nat() }), weight: 2 },
  {
    arbitrary: fc.record({
      type: fc.constant('target'),
      pick: fc.nat(),
      userId: fc.integer({ min: 1, max: TRADERS }),
      dollars: fc.integer({ min: 1, max: 12 }),
      grade: fc.integer({ min: 1, max: 8 }),
      sameMillisecond: fc.boolean(),
    }),
    weight: 2,
  },
);

/** The reference rule for "could these two trade", written without the engine's helpers. */
function compatible(incoming, resting) {
  if (incoming.side === resting.side || incoming.userId === resting.userId) return false;
  const bid = incoming.side === 'bid' ? incoming : resting;
  const ask = incoming.side === 'ask' ? incoming : resting;
  return ask.priceCents <= bid.priceCents && ask.grade >= bid.minGrade;
}

/** True when `a` should fill before `b`: better price, then earlier, then lower id. */
function before(a, b) {
  if (a.priceCents !== b.priceCents) {
    return a.side === 'ask' ? a.priceCents < b.priceCents : a.priceCents > b.priceCents;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.id < b.id;
}

/** The resting order the reference model would fill, or null: one pass, keep the best. */
function referenceMatch(resting, incoming) {
  let best = null;
  for (const order of resting) {
    if (compatible(incoming, order) && (best === null || before(order, best))) best = order;
  }
  return best;
}

/** Turns generated commands into real orders with increasing ids, times and copy ids. */
function orderMaker() {
  let id = 0;
  let now = 1_700_000_000_000;
  return ({ side, userId, dollars, grade, sameMillisecond }) => {
    id += 1;
    if (!sameMillisecond) now += 1;
    const base = { id, userId, side, priceCents: dollars * 100, createdAt: now };
    return side === 'bid' ? { ...base, minGrade: grade } : { ...base, copyId: 1000 + id, grade };
  };
}

const plain = (orders) => orders.map((order) => ({ ...order }));

/** Run one generated sequence against the book and the model, checking every step. */
function runSequence(commands) {
  const book = new OrderBook(RELEASE);
  const makeOrder = orderMaker();
  /** @type {object[]} the model: every resting order, in no particular order */
  let resting = [];
  const trades = [];

  for (const command of commands) {
    if (command.type === 'cancel') {
      if (resting.length === 0) continue;
      const victim = resting[command.pick % resting.length];
      expect(book.remove(victim.id)).toEqual(victim);
      resting = resting.filter((order) => order.id !== victim.id);
    } else if (command.type === 'place') {
      const incoming = makeOrder(command);
      const snapshot = { asks: plain(book.asks()), bids: plain(book.bids()) };
      const result = book.match(incoming);
      // match() only decides: the book is untouched until apply().
      expect({ asks: plain(book.asks()), bids: plain(book.bids()) }).toEqual(snapshot);

      const expected = referenceMatch(resting, incoming);
      if (expected) {
        const bid = incoming.side === 'bid' ? incoming : expected;
        const ask = incoming.side === 'ask' ? incoming : expected;
        expect(result).toEqual({
          trade: {
            bidOrderId: bid.id,
            askOrderId: ask.id,
            buyerId: bid.userId,
            sellerId: ask.userId,
            copyId: ask.copyId,
            grade: ask.grade,
            priceCents: expected.priceCents, // always the resting order's price
          },
          rests: false,
        });
        resting = resting.filter((order) => order.id !== expected.id);
        trades.push(result.trade);
      } else {
        expect(result).toEqual({ trade: null, rests: true });
        resting.push(incoming);
      }
      book.apply(incoming, result);
    } else {
      // A targeted order ("Buy this copy" / "Sell to them") at one resting order.
      if (resting.length === 0) continue;
      const target = resting[command.pick % resting.length];
      const side = target.side === 'ask' ? 'bid' : 'ask';
      const incoming = { ...makeOrder({ ...command, side }), targetOrderId: target.id };
      const result = book.match(incoming);
      if (compatible(incoming, target)) {
        expect(result.trade).toMatchObject({
          priceCents: target.priceCents,
          copyId: (side === 'ask' ? incoming : target).copyId,
        });
        expect(result.rests).toBe(false);
        resting = resting.filter((order) => order.id !== target.id);
        trades.push(result.trade);
      } else {
        expect(result).toEqual({ trade: null, rests: false, rejected: 'TARGET_UNAVAILABLE' });
      }
      book.apply(incoming, result); // a targeted order never rests, matched or not
    }

    checkBook(book, resting);
  }
  for (const trade of trades) expect(trade.buyerId).not.toBe(trade.sellerId);
}

/** The properties that hold after every step, whatever came before. */
function checkBook(book, resting) {
  const asks = book.asks();
  const bids = book.bids();
  // Same orders as the model, and in priority order on each side.
  expect(plain([...asks, ...bids]).sort((a, b) => a.id - b.id)).toEqual(
    plain(resting).sort((a, b) => a.id - b.id),
  );
  for (let i = 1; i < asks.length; i += 1) expect(before(asks[i], asks[i - 1])).toBe(false);
  for (let i = 1; i < bids.length; i += 1) expect(before(bids[i], bids[i - 1])).toBe(false);
  // Never crossed: no resting bid could take a resting ask from someone else.
  for (const bid of bids) {
    for (const ask of asks) expect(compatible(bid, ask)).toBe(false);
  }
  // One FOR SALE ad per copy, and targeted orders never rest.
  expect(new Set(asks.map((ask) => ask.copyId)).size).toBe(asks.length);
  for (const order of [...asks, ...bids]) expect(order.targetOrderId).toBeUndefined();
}

describe('the matching engine, under random order flow', () => {
  it('agrees with the reference model at every step, and is never crossed', () => {
    fc.assert(
      fc.property(fc.array(commandArb, { maxLength: 60 }), (commands) => {
        runSequence(commands);
      }),
      { numRuns: 1500 },
    );
  });

  it('gives the same book whether orders arrive live or are rebuilt after a restart', () => {
    fc.assert(
      fc.property(fc.array(commandArb, { maxLength: 40 }), (commands) => {
        const live = new OrderBook(RELEASE);
        const makeOrder = orderMaker();
        for (const command of commands) {
          if (command.type !== 'place') continue;
          const incoming = makeOrder(command);
          live.apply(incoming, live.match(incoming));
        }
        // Restart: add() the resting orders back in id order, the way recover() reads them.
        const rebuilt = new OrderBook(RELEASE);
        for (const order of [...live.asks(), ...live.bids()].sort((a, b) => a.id - b.id)) {
          rebuilt.add(order);
        }
        expect(plain(rebuilt.asks())).toEqual(plain(live.asks()));
        expect(plain(rebuilt.bids())).toEqual(plain(live.bids()));
      }),
      { numRuns: 500 },
    );
  });
});
