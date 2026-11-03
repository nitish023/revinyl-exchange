// The matching rules are in docs/parts/part-1-matching-engine.md.
import { describe, expect, it } from 'vitest';
import {
  fieldErrors,
  formatCents,
  gradeByCode,
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  parseDollars,
  validateOrder,
} from '../../../shared/index.js';
import { errorHandler } from '../errors.js';
import { OrderBook } from './orderBook.js';

const RELEASE_ID = 249504;
const START = 1_700_000_000_000;
const BUYER = 1;
const SELLER = 2;

const rank = (code) => gradeByCode(code).rank;
const VG = rank('VG');
const VG_PLUS = rank('VG+');
const NM = rank('NM');

/** By default an order's time follows its id, so a test only sets createdAt when it matters. */
function bid(overrides) {
  return {
    side: 'bid',
    userId: BUYER,
    priceCents: 4000,
    minGrade: VG_PLUS,
    createdAt: START + overrides.id,
    ...overrides,
  };
}

function ask(overrides) {
  return {
    side: 'ask',
    userId: SELLER,
    priceCents: 4000,
    grade: VG_PLUS,
    copyId: 1000 + overrides.id,
    createdAt: START + overrides.id,
    ...overrides,
  };
}

function bookWith(...orders) {
  const book = new OrderBook(RELEASE_ID);
  for (const order of orders) book.add(order);
  return book;
}

const ids = (orders) => orders.map((order) => order.id);
const snapshot = (book) => ({ asks: book.asks(), bids: book.bids() });
const NO_MATCH = { trade: null, rests: true };
const TARGET_REJECTED = { trade: null, rests: false, rejected: 'TARGET_UNAVAILABLE' };

/** The per-field messages validateOrder reports for `order`. */
function orderProblems(order) {
  try {
    validateOrder(order);
  } catch (error) {
    return fieldErrors(error);
  }
  return {};
}

describe('OrderBook: incoming bid (WANTED ad)', () => {
  it('fills against the cheapest ask whose grade meets the bid’s minimum grade', () => {
    const book = bookWith(
      ask({ id: 1, priceCents: 4500, grade: NM }),
      ask({ id: 2, priceCents: 4000, grade: VG_PLUS, copyId: 77, userId: 22 }),
      ask({ id: 3, priceCents: 4200, grade: NM }),
    );

    const result = book.match(bid({ id: 9, userId: 11, priceCents: 5000, minGrade: VG_PLUS }));

    expect(result).toEqual({
      trade: {
        bidOrderId: 9,
        askOrderId: 2,
        buyerId: 11,
        sellerId: 22,
        copyId: 77,
        grade: VG_PLUS,
        priceCents: 4000,
      },
      rests: false,
    });
  });

  it('records the copy’s actual grade on the trade, not the bid’s minimum', () => {
    const book = bookWith(ask({ id: 1, grade: NM }));

    const { trade } = book.match(bid({ id: 9, minGrade: VG }));

    expect(trade.grade).toBe(NM);
  });

  it('skips a cheaper ask whose grade is below the minimum', () => {
    const book = bookWith(
      ask({ id: 1, priceCents: 3000, grade: VG }),
      ask({ id: 2, priceCents: 4000, grade: VG_PLUS }),
    );

    const { trade } = book.match(bid({ id: 9, priceCents: 5000, minGrade: VG_PLUS }));

    expect(trade.askOrderId).toBe(2);
  });

  it('trades at the resting ask’s price, not the bid’s maximum', () => {
    const book = bookWith(ask({ id: 1, priceCents: 4000 }));

    const { trade } = book.match(bid({ id: 9, priceCents: 5000 }));

    expect(trade.priceCents).toBe(4000);
  });

  it('rests when no ask is cheap enough or good enough', () => {
    const incoming = bid({ id: 9, priceCents: 4000, minGrade: VG_PLUS });

    expect(new OrderBook(RELEASE_ID).match(incoming)).toEqual(NO_MATCH);
    expect(bookWith(ask({ id: 1, priceCents: 4001 })).match(incoming)).toEqual(NO_MATCH);
    expect(bookWith(ask({ id: 1, priceCents: 3000, grade: VG })).match(incoming)).toEqual(NO_MATCH);
  });
});

describe('OrderBook: incoming ask (FOR SALE ad)', () => {
  it('fills against the highest bid that accepts this copy’s grade', () => {
    const book = bookWith(
      bid({ id: 1, priceCents: 4500, minGrade: VG }),
      bid({ id: 2, priceCents: 5000, minGrade: VG_PLUS, userId: 11 }),
      bid({ id: 3, priceCents: 3000, minGrade: VG }),
    );

    const result = book.match(
      ask({ id: 9, userId: 22, priceCents: 3000, grade: VG_PLUS, copyId: 77 }),
    );

    expect(result).toEqual({
      trade: {
        bidOrderId: 2,
        askOrderId: 9,
        buyerId: 11,
        sellerId: 22,
        copyId: 77,
        grade: VG_PLUS,
        priceCents: 5000,
      },
      rests: false,
    });
  });

  it('skips a higher bid whose minimum grade is above this copy', () => {
    const book = bookWith(
      bid({ id: 1, priceCents: 9000, minGrade: NM }),
      bid({ id: 2, priceCents: 4000, minGrade: VG_PLUS }),
    );

    const { trade } = book.match(ask({ id: 9, priceCents: 3000, grade: VG_PLUS }));

    expect(trade.bidOrderId).toBe(2);
  });

  it('trades at the resting bid’s price', () => {
    const book = bookWith(bid({ id: 1, priceCents: 4500 }));

    const { trade } = book.match(ask({ id: 9, priceCents: 3000 }));

    expect(trade.priceCents).toBe(4500);
  });

  it('rests when no bid qualifies', () => {
    const incoming = ask({ id: 9, priceCents: 4000, grade: VG_PLUS });

    expect(new OrderBook(RELEASE_ID).match(incoming)).toEqual(NO_MATCH);
    expect(bookWith(bid({ id: 1, priceCents: 3999 })).match(incoming)).toEqual(NO_MATCH);
    expect(bookWith(bid({ id: 1, priceCents: 9000, minGrade: NM })).match(incoming)).toEqual(
      NO_MATCH,
    );
  });

  it('matches when the prices are exactly equal, from either side', () => {
    expect(bookWith(ask({ id: 1 })).match(bid({ id: 9 })).trade.priceCents).toBe(4000);
    expect(bookWith(bid({ id: 1 })).match(ask({ id: 9 })).trade.priceCents).toBe(4000);
  });
});

describe('OrderBook: priority and fairness', () => {
  it('equal prices: the earlier order wins', () => {
    // The later order is added first (and has the lower id), so only createdAt can decide.
    const asks = bookWith(
      ask({ id: 1, createdAt: START + 500 }),
      ask({ id: 2, createdAt: START + 100 }),
    );
    const bids = bookWith(
      bid({ id: 1, createdAt: START + 500 }),
      bid({ id: 2, createdAt: START + 100 }),
    );

    expect(asks.match(bid({ id: 9 })).trade.askOrderId).toBe(2);
    expect(bids.match(ask({ id: 9 })).trade.bidOrderId).toBe(2);
  });

  it('equal prices and times: the lower id wins', () => {
    // The higher id is added first, so the lower id can't win by being found first.
    const asks = bookWith(ask({ id: 2, createdAt: START }), ask({ id: 1, createdAt: START }));
    const bids = bookWith(bid({ id: 2, createdAt: START }), bid({ id: 1, createdAt: START }));

    expect(asks.match(bid({ id: 9 })).trade.askOrderId).toBe(1);
    expect(bids.match(ask({ id: 9 })).trade.bidOrderId).toBe(1);
  });

  it('price beats time: a better price wins even when it arrived later', () => {
    const asks = bookWith(
      ask({ id: 1, priceCents: 4000, createdAt: START }),
      ask({ id: 2, priceCents: 3900, createdAt: START + 100 }),
    );
    const bids = bookWith(
      bid({ id: 1, priceCents: 4000, createdAt: START }),
      bid({ id: 2, priceCents: 4100, createdAt: START + 100 }),
    );

    expect(asks.match(bid({ id: 9 })).trade.askOrderId).toBe(2);
    expect(bids.match(ask({ id: 9 })).trade.bidOrderId).toBe(2);
  });

  it('never matches a user’s own orders, and picks the next eligible one instead', () => {
    const asks = bookWith(
      ask({ id: 1, priceCents: 3000, userId: BUYER }),
      ask({ id: 2, priceCents: 4000, userId: SELLER }),
    );
    const bids = bookWith(
      bid({ id: 1, priceCents: 5000, userId: SELLER }),
      bid({ id: 2, priceCents: 4000, userId: BUYER }),
    );

    expect(asks.match(bid({ id: 9, userId: BUYER })).trade.askOrderId).toBe(2);
    expect(bids.match(ask({ id: 9, userId: SELLER })).trade.bidOrderId).toBe(2);
  });

  it('rests when the user’s own orders are the only ones that would match', () => {
    const book = bookWith(ask({ id: 1, userId: BUYER }));

    expect(book.match(bid({ id: 9, userId: BUYER }))).toEqual(NO_MATCH);
  });
});

describe('OrderBook: match, apply and remove', () => {
  it('match() does not change the book', () => {
    const book = bookWith(ask({ id: 1, priceCents: 4000 }), bid({ id: 2, priceCents: 3000 }));
    const before = snapshot(book);

    book.match(bid({ id: 9, priceCents: 5000 })); // would fill
    book.match(bid({ id: 10, priceCents: 1000 })); // would rest
    book.match(bid({ id: 11, targetOrderId: 404 })); // would be rejected

    expect(snapshot(book)).toEqual(before);
  });

  it('apply() removes the filled resting order and does not rest the incoming one', () => {
    const book = bookWith(ask({ id: 1 }), ask({ id: 2, priceCents: 4100 }));
    const incoming = bid({ id: 9, priceCents: 5000 });

    book.apply(incoming, book.match(incoming));

    expect(ids(book.asks())).toEqual([2]);
    expect(book.bids()).toEqual([]);
  });

  it('apply() removes the filled bid when the incoming order is an ask', () => {
    const book = bookWith(bid({ id: 1 }), bid({ id: 2, priceCents: 3000 }));
    const incoming = ask({ id: 9, priceCents: 4000 });

    book.apply(incoming, book.match(incoming));

    expect(ids(book.bids())).toEqual([2]);
    expect(book.asks()).toEqual([]);
  });

  it('apply() rests an incoming order that did not trade', () => {
    const book = new OrderBook(RELEASE_ID);
    const incomingBid = bid({ id: 9 });
    const incomingAsk = ask({ id: 10, priceCents: 9000 });

    book.apply(incomingBid, book.match(incomingBid));
    book.apply(incomingAsk, book.match(incomingAsk));

    expect(book.bids()).toEqual([incomingBid]);
    expect(book.asks()).toEqual([incomingAsk]);
  });

  it('remove() takes a resting order out and returns it; unknown ids return null', () => {
    const resting = ask({ id: 1 });
    const book = bookWith(resting, bid({ id: 2, priceCents: 1000 }));

    expect(book.remove(1)).toEqual(resting);
    expect(book.asks()).toEqual([]);
    expect(book.remove(1)).toBeNull();
    expect(book.remove(404)).toBeNull();
    expect(ids(book.bids())).toEqual([2]);
  });

  it('asks() and bids() come back sorted for display', () => {
    const book = bookWith(
      ask({ id: 5, priceCents: 5000 }),
      ask({ id: 4, priceCents: 4000, createdAt: START }),
      ask({ id: 3, priceCents: 4000, createdAt: START }),
      ask({ id: 2, priceCents: 4000, createdAt: START - 1 }),
      ask({ id: 1, priceCents: 6000 }),
      bid({ id: 10, priceCents: 1000 }),
      bid({ id: 14, priceCents: 3000, createdAt: START }),
      bid({ id: 13, priceCents: 3000, createdAt: START }),
      bid({ id: 12, priceCents: 3000, createdAt: START - 1 }),
      bid({ id: 11, priceCents: 2000 }),
    );

    expect(ids(book.asks())).toEqual([2, 3, 4, 5, 1]);
    expect(ids(book.bids())).toEqual([12, 13, 14, 11, 10]);
  });
});

describe('OrderBook: targeted orders ("Buy this copy" / "Sell to them")', () => {
  it('fills against exactly the targeted resting order when it is eligible', () => {
    const book = bookWith(ask({ id: 1, priceCents: 3000 }), ask({ id: 2, priceCents: 4000 }));

    const { trade, rests } = book.match(bid({ id: 9, priceCents: 5000, targetOrderId: 2 }));

    expect(trade.askOrderId).toBe(2); // not the cheaper order 1
    expect(trade.priceCents).toBe(4000);
    expect(rests).toBe(false);
  });

  it('works from the seller’s side too ("Sell to them")', () => {
    const book = bookWith(bid({ id: 1, priceCents: 5000 }), bid({ id: 2, priceCents: 4000 }));

    const { trade } = book.match(ask({ id: 9, priceCents: 3000, targetOrderId: 2 }));

    expect(trade.bidOrderId).toBe(2);
    expect(trade.priceCents).toBe(4000);
  });

  it('is rejected with TARGET_UNAVAILABLE (and never rests) when the target is gone or not eligible', () => {
    const book = bookWith(
      ask({ id: 1, priceCents: 6000 }),
      ask({ id: 2, grade: VG }),
      ask({ id: 3, userId: BUYER }),
      bid({ id: 4, userId: 44, priceCents: 1000 }),
    );
    const buyThis = (targetOrderId) => bid({ id: 9, priceCents: 5000, targetOrderId });

    expect(book.match(buyThis(404))).toEqual(TARGET_REJECTED); // gone
    expect(book.match(buyThis(1))).toEqual(TARGET_REJECTED); // too expensive
    expect(book.match(buyThis(2))).toEqual(TARGET_REJECTED); // grade too low
    expect(book.match(buyThis(3))).toEqual(TARGET_REJECTED); // the buyer's own copy
    expect(book.match(buyThis(4))).toEqual(TARGET_REJECTED); // another bid, not an ask
  });

  it('rejects an ask that targets another ask', () => {
    const book = bookWith(ask({ id: 1, userId: 44 }));

    expect(book.match(ask({ id: 9, targetOrderId: 1 }))).toEqual(TARGET_REJECTED);
  });

  it('leaves the book alone when apply() gets a rejected result', () => {
    const book = bookWith(ask({ id: 1, priceCents: 6000 }));
    const before = snapshot(book);
    const incoming = bid({ id: 9, priceCents: 5000, targetOrderId: 1 });

    book.apply(incoming, book.match(incoming));

    expect(snapshot(book)).toEqual(before);
  });

  it('treats a null target like no target (how a database row says "none")', () => {
    const book = bookWith(ask({ id: 1 }));

    expect(book.match(bid({ id: 9, targetOrderId: null })).trade.askOrderId).toBe(1);
  });
});

describe('OrderBook: protecting itself from bad input', () => {
  // pg returns bigint columns as strings. '10' === 10 is false, so a string userId would
  // let someone trade with themselves, and '9000' <= '10000' is false for prices.
  it.each([
    ['userId', { userId: '1' }],
    ['priceCents', { priceCents: '4000' }],
    ['id', { id: '9' }],
    ['createdAt', { createdAt: new Date(START) }],
    ['minGrade', { minGrade: '6' }],
  ])('refuses a bid whose %s is not a whole number', (field, overrides) => {
    const order = { ...bid({ id: 9 }), ...overrides };
    const book = new OrderBook(RELEASE_ID);

    expect(() => book.add(order)).toThrow(field);
    expect(() => book.match(order)).toThrow(field);
  });

  it.each([
    ['grade', { grade: undefined }],
    ['copyId', { copyId: '77' }],
    ['priceCents', { priceCents: 40.5 }],
  ])('refuses an ask whose %s is not a whole number', (field, overrides) => {
    const order = { ...ask({ id: 9 }), ...overrides };

    expect(() => new OrderBook(RELEASE_ID).match(order)).toThrow(field);
  });

  it('refuses an unknown side and a target that is not a whole number', () => {
    const book = new OrderBook(RELEASE_ID);

    expect(() => book.match({ ...bid({ id: 9 }), side: 'buy' })).toThrow('side');
    expect(() => book.match(bid({ id: 9, targetOrderId: '1' }))).toThrow('targetOrderId');
  });

  it('refuses an order id that is already resting', () => {
    const book = bookWith(ask({ id: 1 }));

    expect(() => book.add(ask({ id: 1, copyId: 5 }))).toThrow('already');
    expect(() => book.match(bid({ id: 1 }))).toThrow('already');
  });

  it('refuses a second open ask for the same copy, so it can’t be sold twice', () => {
    const book = bookWith(ask({ id: 1, copyId: 77 }), bid({ id: 2 }));

    expect(() => book.add(ask({ id: 3, copyId: 77 }))).toThrow('77');
    expect(() => book.match(ask({ id: 3, copyId: 77 }))).toThrow('77');
  });

  it('lets a copy be listed again once its ask has been cancelled', () => {
    const book = bookWith(ask({ id: 1, copyId: 77 }));

    book.remove(1);

    expect(() => book.add(ask({ id: 2, copyId: 77 }))).not.toThrow();
  });

  it('refuses to rest a targeted order', () => {
    expect(() => bookWith(bid({ id: 9, targetOrderId: 1 }))).toThrow('targeted');
  });

  it('apply() throws and changes nothing when the resting order has already gone', () => {
    const book = bookWith(ask({ id: 1 }), ask({ id: 2, priceCents: 5000 }));
    const incoming = bid({ id: 9, priceCents: 6000 });
    const result = book.match(incoming);
    book.remove(1); // cancelled between match and apply
    const before = snapshot(book);

    expect(() => book.apply(incoming, result)).toThrow('resting order 1');
    expect(snapshot(book)).toEqual(before);
  });

  it('applying the same result twice can’t fill two orders', () => {
    const book = bookWith(ask({ id: 1 }), ask({ id: 2 }));
    const incoming = bid({ id: 9 });
    const result = book.match(incoming);

    book.apply(incoming, result);

    expect(() => book.apply(incoming, result)).toThrow();
    expect(ids(book.asks())).toEqual([2]);
  });

  it('is not affected by later changes to objects passed in or handed out', () => {
    const original = ask({ id: 1 });
    const book = bookWith(original, ask({ id: 2, priceCents: 5000 }));

    original.priceCents = 1;
    book.asks().pop();
    expect(() => {
      book.asks()[0].priceCents = 1;
    }).toThrow(TypeError);

    expect(book.asks().map((order) => order.priceCents)).toEqual([4000, 5000]);
  });
});

describe('order rules (shared/orders.js)', () => {
  it('accepts whole-cent prices from $1.00 to $10,000.00', () => {
    expect(MIN_PRICE_CENTS).toBe(100);
    expect(MAX_PRICE_CENTS).toBe(1_000_000);

    for (const priceCents of [MIN_PRICE_CENTS, 4050, MAX_PRICE_CENTS]) {
      expect(orderProblems({ side: 'bid', priceCents, minGrade: VG_PLUS })).toEqual({});
      expect(orderProblems({ side: 'ask', priceCents, grade: VG_PLUS, copyId: 77 })).toEqual({});
    }
  });

  it('rejects bad sides, prices and grades with a clear message', () => {
    const goodBid = { side: 'bid', priceCents: 4000, minGrade: VG_PLUS };
    const goodAsk = { side: 'ask', priceCents: 4000, grade: VG_PLUS, copyId: 77 };
    const priceLimits = 'Price must be between $1.00 and $10,000.00';

    expect(orderProblems({ ...goodBid, side: 'buy' }).side).toBe(
      'An order must be a bid or an ask',
    );
    expect(orderProblems({ ...goodBid, priceCents: 99 }).priceCents).toBe(priceLimits);
    expect(orderProblems({ ...goodBid, priceCents: 1_000_001 }).priceCents).toBe(priceLimits);
    expect(orderProblems({ ...goodBid, priceCents: 40.5 }).priceCents).toBe(
      'Price must be in whole cents',
    );
    expect(orderProblems({ ...goodBid, priceCents: null }).priceCents).toBe(
      'Enter a price like 40.50',
    );
    expect(orderProblems({ ...goodBid, minGrade: 0 }).minGrade).toBe(
      'Minimum grade must be from 1 (Poor) to 8 (Mint)',
    );
    expect(orderProblems({ ...goodBid, minGrade: 9 }).minGrade).toBe(
      'Minimum grade must be from 1 (Poor) to 8 (Mint)',
    );
    expect(orderProblems({ side: 'bid', priceCents: 4000 }).minGrade).toBe(
      'Pick the lowest grade you’ll accept',
    );
    expect(orderProblems({ ...goodAsk, grade: 0 }).grade).toBe(
      'Grade must be from 1 (Poor) to 8 (Mint)',
    );
    expect(orderProblems({ side: 'ask', priceCents: 4000, copyId: 77 }).grade).toBe(
      'Pick the copy’s grade',
    );
    expect(orderProblems({ side: 'ask', priceCents: 4000, grade: VG_PLUS }).copyId).toBe(
      'Pick the copy you’re selling',
    );
  });

  it('parses "40", "40.5" and "40.50" into 4000, 4050 and 4050 cents without floats', () => {
    expect(parseDollars('40')).toBe(4000);
    expect(parseDollars('40.5')).toBe(4050);
    expect(parseDollars('40.50')).toBe(4050);
    // The classic float trap: 19.99 * 100 is 1998.9999999999998.
    expect(parseDollars('19.99')).toBe(1999);
    for (const bad of ['40.505', '-1', 'abc', '']) expect(parseDollars(bad)).toBeNull();
  });

  it('formats 4050 cents as "40.50"', () => {
    expect(formatCents(4050)).toBe('40.50');
    expect(formatCents(100)).toBe('1.00');
    expect(formatCents(5)).toBe('0.05');
  });

  it('a bad order reaches the user as a 400 with field messages, not a generic 500', () => {
    let thrown;
    try {
      validateOrder({ side: 'bid', priceCents: 1, minGrade: VG_PLUS });
    } catch (error) {
      thrown = error;
    }
    const response = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
      },
    };

    errorHandler(thrown, {}, response, () => undefined);

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fields.priceCents).toBe(
      'Price must be between $1.00 and $10,000.00',
    );
  });
});
