# Part 1 (Sauransh, week 7): the matching engine

**Goal:** decide, for one pressing, which buyer gets which copy and at what price. This is pure logic with no database,
no routes and no UI, so you can build and test it on your own this week. Parts 3 and 5 plug it into the database and
the pages.

**Where:** `server/src/market/orderBook.js` (the starter file already has every method and the data shapes in JSDoc),
`server/src/market/orderBook.test.js` (the checklist of tests as `it.todo`), and a new `shared/orders.js` for the rules
the forms will reuse.

**Done when:** every `it.todo` in `orderBook.test.js` is a real, passing test, `npm test` and `npm run lint` pass, and
the PR is reviewed and merged into `main`.

## How reVINYL trades

- Every pressing (a Discogs release) has its own `OrderBook`.
- A **bid** is a WANTED ad: "I'll pay up to $40 for a copy in VG+ or better." It has a max price and a minimum grade.
- An **ask** is a FOR SALE ad for one specific copy: "This VG+ copy, $42." It has a price, the copy's id and its grade.
- Every order is for exactly **one copy**, so a match makes at most one trade. An incoming order either fills completely
  against one resting order, or rests in the book. There are no partial fills.
- Grades are numbers from `shared/grades.js`: P 1, F 2, G 3, G+ 4, VG 5, VG+ 6, NM 7, M 8. "VG+ or better" means
  `grade >= 6` (use `meetsMinimumGrade`).
- Money is **whole cents as JavaScript numbers** (`4050` is $40.50). Never use floating-point dollars.

## Matching rules

1. **Incoming bid:** look at asks whose `grade >= bid.minGrade` and `priceCents <= bid.priceCents`. Take the cheapest.
2. **Incoming ask:** look at bids whose `minGrade <= ask.grade` and `priceCents >= ask.priceCents`. Take the highest.
3. **Ties:** equal price goes to the earlier `createdAt`, then the lower `id`.
4. **Price:** the trade happens at the **resting** order's price. If a $50 bid meets a resting $40 ask, it trades at
   $40. If a $30 ask meets a resting $45 bid, it trades at $45.
5. **No self-trades:** skip resting orders from the same `userId` and keep looking for the next eligible one.
6. **No match:** the incoming order rests (`rests: true`).
7. **Targeted orders** (for Part 5's "Buy this copy" and "Sell to them"): if `targetOrderId` is set, only that resting
   order may match. If it's gone, or not eligible under rules 1, 2 and 5, return
   `{ trade: null, rests: false, rejected: 'TARGET_UNAVAILABLE' }`. A targeted order never rests.

## Match, then apply

`match(incoming)` must **not** change the book. It returns `{ trade, rests }`. Later parts save the order and trade in
one database transaction, and only after that commits call `apply(incoming, result)`, which removes the filled resting
order (or adds the incoming one if it rests). This way a failed save can't leave the book and the database disagreeing.

`add(order)` puts an order in without matching (used to rebuild books from the database when the server starts).
`remove(orderId)` is cancel: it returns the removed order, or `null`. `asks()` returns resting asks cheapest first, and
`bids()` returns resting bids highest first, both with the tie rules above (Part 4 shows them as ads).

A `Trade` has: `bidOrderId`, `askOrderId`, `buyerId`, `sellerId`, `copyId`, `grade`, `priceCents`.

## `shared/orders.js` (rules the forms reuse)

- `MIN_PRICE_CENTS = 100` ($1.00) and `MAX_PRICE_CENTS = 1_000_000` ($10,000.00).
- `parseDollars("40.5")` returns `4050`. Accept `"40"`, `"40.5"` and `"40.50"`; reject `"40.505"`, `"-1"`, `"abc"` and
  `""` by returning `null`. Do it with string splitting, not `parseFloat`.
- `formatCents(4050)` returns `"40.50"`.
- `validateOrder(order)` throws a `ZodError` with a clear message for a bad side, a price outside the limits or not
  whole cents, a grade or minimum grade outside 1 to 8, a bid without `minGrade`, or an ask without `copyId` and `grade`.
  `errorHandler` turns that into a 400 with per-field messages. It returns only the fields it checked.

## What the book refuses

`add()` and `match()` throw if an order's ids, price, time or grade aren't whole numbers. **Convert database rows with
`Number()` first:** `pg` returns `bigint` columns as strings, and a string `userId` would slip past the self-trade rule.
They also throw for an order id already in the book or a second open ask for the same copy, `add()` throws for a targeted
order, and `apply()` throws if the resting order it should fill has gone. These all mean a bug in our code, so they're
plain errors rather than messages for users.

## Not in Part 1

No database tables, routes, forms or WebSockets. The `orders`, `copies` and `trades` tables are Part 3 (week 8), and the
buy and sell buttons are Part 5. Plain JavaScript, ES modules, `.js` extensions in imports. Run `npm test` while you
work.

## Setup

```bash
git clone https://github.com/nitish023/revinyl-exchange.git
cd revinyl-exchange
npm install
npm test            # unit tests, no database needed for Part 1
git checkout -b sauransh/part-1-matching-engine
```
