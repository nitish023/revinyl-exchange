# Part 3 (Sauransh, week 8): crates, orders and held cash

**Goal:** people can put records in their crate, run FOR SALE and WANTED ads, and cancel them. Their money is held
while a WANTED ad runs. Your matching engine from Part 1 decides every match; this part connects it to the database
and the pressing page.

**Where:**

- `server/src/orders/orderService.js`: the starter has the three methods and the rules in comments.
- New route files for the crate, orders and wallet (`server/src/crate/routes.js`, `server/src/orders/routes.js`),
  added in `server/src/app.js` next to the others.
- New schemas in `shared/` for the request bodies, so the forms and the server agree.
- `client/src/components/adCoupons.js`: the starter is already called by the market section and returns `null`.
- A simple crate page at `/crate`, and a "Your Crate" link in the masthead when logged in.
- Tests: `server/test/orders.int.test.js` has the checklist as `it.todo`.

**Done when:** every `it.todo` in `orders.int.test.js` is a real, passing test, `npm run test:all` and `npm run lint`
pass, and the PR is reviewed and merged into `main`.

## Already done for you (week 8 setup, merged before you start)

- **Tables** in `server/migrations/003_crate_orders_trades.sql`: `users.cash_cents` and `users.held_cents`, `copies`,
  `copy_photos`, `orders`, `trades`. Read the comments in that file first. Don't edit it; if you need a change, add
  `004_….sql`.
- **bigint comes back as a number** from pg now (`server/src/db/pool.js`), so a row can go straight into
  `OrderBook.add()`. `sum()` returns numeric, so cast it: `sum(price_cents)::bigint`.
- **`shared/copies.js`**: condition flags, field limits, `STARTING_CASH_CENTS`, and `conditionText(6, 5)` -> `"VG+/VG"`.
- **`ctx.live`** (`server/src/market/live.js`): call `ctx.live.marketChanged(releaseId)` after every commit that
  changes a pressing's orders, and `ctx.live.notifyUser(userId, { type, ... })` for each person involved. Part 4 turns
  these into WebSocket messages. In tests, `ctx.live` records the calls (`ctx.live.markets`, `ctx.live.messages`).
- **Demo data:** `npm run db:seed` makes five traders (`groovegarden@example.com` and others, password `password123`)
  and a month of market activity for release 249504. `server/test/marketSchema.int.test.js` checks the seed keeps the
  rules below, which is a good model for your own tests.

## How the money works

`cash_cents` is everything a user has. `held_cents` is the part set aside for open WANTED ads. **Spendable** is
`cash_cents - held_cents`. The database refuses `held_cents > cash_cents`.

| Event                                     | Buyer                                                           | Seller      | Copy                   |
| ----------------------------------------- | --------------------------------------------------------------- | ----------- | ---------------------- |
| Bid placed, rests                         | `held += bid price` (needs spendable >= price)                  |             |                        |
| Bid cancelled                             | `held -= bid price`                                             |             |                        |
| Ask placed, rests                         |                                                                 |             | `in_crate` -> `listed` |
| Ask cancelled                             |                                                                 |             | `listed` -> `in_crate` |
| Trade (either order was the incoming one) | release the bid's hold if it was resting, `cash -= trade price` | nothing yet | -> `in_trade`          |

The trade price is always the **resting** order's price (Part 1). So an incoming $50 bid that meets a resting $40 ask
costs the buyer $40 and holds nothing extra. An incoming bid still needs spendable >= its own price, even if it fills
for less.

The seller is paid in Part 5, when the buyer checks the record. Until then the money is in the trade
(`trades.price_cents`), which is why the seller's cash doesn't change here. Both orders become `filled` with
`closed_at` set; the trade starts as `awaiting_shipment`.

## Placing an order

1. Check the body with a shared schema (price as a string like `"40.50"`, turned into cents with `parseDollars`), then
   `validateOrder`. Bids also take `releaseId`, `minGrade` and an optional `note` (up to 200 characters). Asks take
   `copyId` and `price`; the release and grade come from the copy, never from the request.
2. `await ctx.catalog.ensureRelease(releaseId)` for a bid.
3. Run the rest in the queue for that release id, so orders for one pressing go one at a time. A small
   `KeyedSerialQueue` (a Map of promise chains) is enough; write it with a unit test.
4. In one transaction (`withTransaction`): lock the user's row (`SELECT … FOR UPDATE`), check the copy or spendable
   cash, insert the order, `book.match()` it using the new row's `id` and `created_at`, then write the trade, wallet
   and copy changes.
5. After COMMIT: `book.apply(order, result)`, then `ctx.live`.

If anything throws, the transaction rolls back and the book was never touched. Answer with `AppError`:
`INSUFFICIENT_FUNDS` (400, on the `price` field), `COPY_NOT_AVAILABLE` (409), `ORDER_NOT_OPEN` (409), and 404 for an
order or copy that isn't yours (don't reveal that it exists).

Load a pressing's book the first time it's used: its open orders, with each ask's grade from `copies`. Restart
recovery is Part 7, so a lazy load is all you need.

## API

| Method | Path                               | Body / result                                                                                                     |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/wallet`                      | `{ cash, held, spendable }` as `"2000.00"` strings                                                                |
| GET    | `/api/crate?releaseId=`            | my copies (optionally just one pressing), with the pressing's title and cover                                     |
| POST   | `/api/crate`                       | `{ releaseId, grade, sleeveGrade \| null, flags, headline, notes }` -> 201 copy                                   |
| DELETE | `/api/crate/:id`                   | only while `in_crate` -> 204                                                                                      |
| POST   | `/api/crate/:id/photos`            | the image itself as the body (`express.raw({ type: PHOTO_TYPES, limit: '2mb' })`)                                 |
| GET    | `/api/copies/:id/photos/:position` | the image, for anyone (photos are shown on ads)                                                                   |
| GET    | `/api/orders?status=open`          | my orders                                                                                                         |
| POST   | `/api/orders`                      | `{ side: 'bid', releaseId, price, minGrade, note }` or `{ side: 'ask', copyId, price }` -> 201 `{ order, trade }` |
| DELETE | `/api/orders/:id`                  | cancel -> the cancelled order                                                                                     |

All of them need `requireUser` except the photo GET. Add them to the API table in `docs/PROJECT.md`.

## The forms (pressing page)

Build them with the design pieces in `client/src/styles.css`: `.coupon` for each form, `.field`, `.input`, `.button`.
Look at the "Run your own ad" coupon on the design canvas (page "The Paper", InsidePageAiry board): the lowest grade
is a set of radio buttons ("NM or better", "VG+ or better", …), and the note under the button says how much is held.

- **Add a copy:** record grade, sleeve grade with a "generic sleeve" option, the condition flags as checkboxes
  (`CONDITION_FLAGS`), a short headline ("Played twice.") and notes.
- **Sell your copy:** pick one of your `in_crate` copies of this pressing (or add one first), set a price.
- **Run your own ad:** lowest grade, most you'll pay, an optional note.
- Show the server's messages next to the right field (`errorsFromUnknown` in `client/src/lib/forms.js`), and call
  `onPosted()` after a success.

## Not in Part 3

The market page itself, the Market Report and live updates are Part 4 (Nitish). "Buy this copy", "Sell to them",
shipping, checking and refunds are Part 5 (yours, week 9). When you get there: selling a copy that is already listed
to a WANTED ad has to cancel its listing in the same transaction (your engine refuses a second ask for that copy), and
a "Buy this copy" bid must be at least the ask's price or the engine rejects it.

## Setup

```bash
git checkout main && git pull
npm install
npm run db:up && npm run db:seed
npm run test:all
git checkout -b sauransh/part-3-crate-and-orders
```

## As built

- **Removing a copy** keeps the row and sets `copies.removed_at` (migration 004), because a copy that was ever listed
  is named by old orders. Its photos are deleted. Only an `in_crate` copy can be removed (409 otherwise).
- **Photos** are stored with the type read from their first bytes, not the `Content-Type` the browser claims, so a
  renamed file is refused (415). A copy in a trade can't get new photos (409).
- **Locks:** a bid locks the buyer's wallet then the copy it buys; an ask locks its copy then the buyer's wallet. Those
  only meet on the same copy, so the same pressing, which the queue runs one at a time: no deadlocks.
- **When the book and the database disagree** (the trade write finds the resting order already closed), the
  transaction rolls back, the book for that pressing is dropped, and the next order reloads it from the database.
- **Live messages:** `order` (with `orderId` and `status`) to each order's owner, `trade` (with `tradeId`) to buyer
  and seller, and `wallet` to whoever's cash or hold changed. Each carries a numeric `releaseId`.
- **Cancelling** is in the "Your ads on this pressing" list under the coupons, and on `/crate`.
