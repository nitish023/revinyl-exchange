# Part 5 (Sauransh, week 9): buying from an ad, selling to a wanted ad, and the trade itself

**Goal:** a buyer can take one specific FOR SALE ad ("Buy this copy"), a seller can answer one specific WANTED ad
("Sell to them"), and every trade can be shipped, checked and either completed or refunded. When a trade completes,
the seller is paid and the record moves to the buyer's shelf.

**Where:**

- `server/src/trades/tradeService.js`: the starter has every method, with the rules in comments.
- Routes in `server/src/trades/routes.js` (new) and two new order routes in `server/src/orders/routes.js`.
- `client/src/components/adActions.js`: the buttons on each ad. The market page already calls it and shows what it
  returns next to each ad's price (it returns `null` until you build it).
- `client/src/components/tradeActions.js`: the buttons on each row of the ledger in the Listening Room (Part 6, mine).
  The ledger calls it the same way.
- Tests: `server/test/trades.int.test.js` has the checklist as `it.todo`.

**Done when:** every `it.todo` in `trades.int.test.js` is a real, passing test, `npm run test:all` and `npm run lint`
pass, and the PR is reviewed and merged into `main` with a merge commit.

## Buy this copy and Sell to them

Both are **targeted orders** (Part 1, rule 7): they may only match the one ad they name, and never rest. The engine
already returns `{ trade: null, rests: false, rejected: 'TARGET_UNAVAILABLE' }` when the ad is gone or doesn't fit.

| Route                                    | Who                       | What happens                                                                   |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `POST /api/orders/:id/buy`               | anyone but the ad's owner | A bid at that ask's price, `minGrade` = the copy's grade, `targetOrderId` = it |
| `POST /api/orders/:id/sell` `{ copyId }` | anyone but the ad's owner | An ask for one of your copies at that bid's price, `targetOrderId` = it        |

- The **server** reads the price, grade and pressing from the ad. The request only names the ad (and, to sell, your
  copy), so nobody can buy a copy for less than its price.
- Run them through `OrderService` and its queue for that pressing, like any other order: match, then save in one
  transaction, then apply. The wallet check is the same as a bid's (spendable must cover the price).
- **Selling a copy that's already listed:** cancel its FOR SALE ad in the same transaction, then sell it. The engine
  refuses a second ask for a copy that has one open, so take the old ask out of the book only after COMMIT, together
  with applying the trade.
- The copy you sell must meet the WANTED ad's lowest grade, be yours and not be in a trade.
- `TARGET_UNAVAILABLE` becomes a 409 with a friendly message ("Someone else just took that ad"), and nothing is saved.

## The trade, after the match

Part 3 already creates the trade as `awaiting_shipment`, takes the price from the buyer's cash, and marks the copy
`in_trade`. The money sits in the trade (`trades.price_cents`) until the buyer checks the record.

| Route                           | Who    | From                                                                       | To          | Money and copy                                                |
| ------------------------------- | ------ | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| `POST /api/trades/:id/ship`     | seller | `awaiting_shipment`                                                        | `shipped`   | nothing moves                                                 |
| `POST /api/trades/:id/cancel`   | seller | `awaiting_shipment`                                                        | `refunded`  | buyer `cash += price`; copy back to the seller, `in_crate`    |
| `POST /api/trades/:id/received` | buyer  | `shipped`                                                                  | `completed` | seller `cash += price`; copy's `owner_id` = buyer, `in_crate` |
| `POST /api/trades/:id/refund`   | buyer  | `shipped`                                                                  | `refunded`  | buyer `cash += price`; copy back to the seller, `in_crate`    |
| `GET /api/trades?status=`       | either | my trades, newest first, with `role: 'buyer' \| 'seller'` and the pressing |

- Lock the trade row (`SELECT … FOR UPDATE`), check who is asking and the status, then change everything in one
  transaction. Anything else is a 409 (`TRADE_NOT_IN_THAT_STATE`); a trade that isn't yours is a 404.
- When two wallets change, lock both users rows **in id order** in one query, so two trades can't deadlock.
- Add `shipped_at` and `settled_at` (and anything else you need) in **migration `006_….sql`**. `005` is mine this
  week (Discogs import).
- After COMMIT: `ctx.live.notifyUser` both people with `{ type: 'trade', releaseId, tradeId, status }`, a `wallet`
  message to whoever's cash changed, and `ctx.live.marketChanged(releaseId)` on a refund (the Market Report leaves
  refunded trades out) and on buy/sell (an ad disappeared).
- There's no real shipping: "Ship it" is a button. The buyer's "It arrived" is the check.

## The buttons

- **`adActions({ release, ad, kind, user, mine, onDone })`** in `client/src/components/adActions.js`. `kind` is
  `'forSale'` or `'wanted'`, `ad` is the ad from the market (see `shared/market.js`), `mine` is true for your own
  ads (show nothing). FOR SALE ads get "Buy this copy" (say the price and what will be held), WANTED ads get "Sell to
  them" with a choice of your copies of this pressing that are good enough (`api.crate(release.id)`). Logged out:
  a "Log in to buy" link. Call `onDone(message)` after a success; the market updates itself over the WebSocket.
- **`tradeActions({ trade, onDone })`** in `client/src/components/tradeActions.js`, for the Listening Room's ledger.
  `trade` has `id`, `role`, `status`, `price`, `release`. Seller: "Ship it" and "Cancel sale" while awaiting
  shipment. Buyer: "It arrived" and "Not as described" once shipped. Confirm the money-moving ones with a second
  press, like the Remove button on the crate.

## Not in Part 5

Restart recovery and invariant tests are Part 7 (week 10). The Listening Room and the ledger are Part 6 (mine): it
reads trades straight from the database and calls your `tradeActions`, so you don't need to touch it.

## Setup

```bash
git checkout main && git pull
npm install
npm run db:up && npm run db:seed
npm run test:all
git checkout -b sauransh/part-5-trades
```

## As built

- **Buy and Sell to them** run in the pressing's queue like any order. The target ad is locked (`FOR UPDATE`) and
  matched against a book holding only that ad, so a targeted order can't fill against anything else. If the ad is
  missing from the book, it's the same `BookOutOfStepError` reload-and-retry as Part 3.
- **Errors:** your own ad is 400 `OWN_AD`; a missing ad, or a WANTED ad sent to `/buy` (and the reverse), is 404; an
  ad that's gone or already taken is 409 `TARGET_UNAVAILABLE`. Selling: a copy that isn't yours is 404, the wrong
  pressing 400 `WRONG_PRESSING`, a copy in a trade 409 `COPY_NOT_AVAILABLE`, and a grade below the ad's lowest 400
  `GRADE_TOO_LOW` (on the `copyId` field).
- **Selling a listed copy** cancels its FOR SALE ad in the same transaction; the old ad leaves the book after COMMIT,
  together with the trade. If the sale fails, the ad stays listed.
- **Migration 006** adds `shipped_at` and `settled_at`. The demo seed writes finished trades directly, so the only
  rule enforced is that a trade still awaiting shipment has no shipping date; older trades take `updated_at`.
- **Locks for a step:** the trade, then both people's wallets in id order (one query), then the copy. The copy must
  still be `in_trade`; anything else is a bug and rolls back.
- **Live messages:** `trade` (with `status`) to both people after every step, `wallet` to whoever was paid, and
  `marketChanged` when a trade settles (completed or refunded).
- **Limits:** trade steps are limited to 30 a minute per visitor; `GET /api/trades` returns the newest 200.
- **Browser:** `api.buy(askId)`, `api.sellTo(bidId, copyId)`, `api.trades({ status })` and
  `api.tradeStep(tradeId, step)` in `client/src/lib/api.js`. Every button is Part 6's `actionButton`: Buy, Sell,
  Cancel sale, It arrived and Not as described need a second press that names the money; Ship it doesn't. A 409
  (someone else acted first) reloads the page with the server's message.
- **Sell to them** reads your crate only when pressed, and lists the copies that fit (in the crate or listed, at the
  ad's lowest grade or better). A listed copy shows its asking price.
- **Discogs instance id:** a completed trade sets the copy's `discogs_instance_id` to NULL (see PROJECT.md,
  "Imported copies"); a refunded copy keeps it.
- **Small changes to Part 6:** the ledger says "To ship" instead of "Ship it" (the button says that now), and "Your ads
  on this pressing" uses `actionButton` for Cancel.
