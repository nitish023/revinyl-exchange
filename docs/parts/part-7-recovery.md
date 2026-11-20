# Part 7 (Sauransh, week 10): restart recovery, concurrency and property-based invariant tests

**Goal:** a restart (a deploy, a crash) loses nothing and trades on nothing stale, and the exchange's rules are
checked, not just hoped for: after every test, at every startup, and on demand.

**Done when:** the server rebuilds its order books and checks the rules on start, every market test checks the rules
afterwards, concurrency and property-based tests hammer the engine and the API, `npm run test:all` and `npm run lint`
pass, and the PR is reviewed and merged into `main` with a merge commit.

## What a restart can lose

Nothing that matters lives only in memory. Every order, trade and wallet change is one transaction (Parts 3 and 5),
and Postgres rolls back a transaction that was cut off before `COMMIT`. The only memory is:

| In memory                                       | After a restart                                               |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Each pressing's order book (`ctx.orders.books`) | Rebuilt from the open orders in the database before listening |
| The queue per pressing (`KeyedSerialQueue`)     | Empty, which is right: nothing is running                     |
| WebSocket subscriptions (`ctx.live`)            | Browsers reconnect and subscribe again (Part 4)               |

Time priority survives because each order's `createdAt` comes from `orders.created_at`, and ties fall back to the id,
which only grows. The book a restarted server builds is the same book the old one had.

## As built (restart recovery)

- **The rules**, `server/src/orders/exchangeRules.js`. `findBrokenRules(db)` runs one query per rule and returns
  `[{ rule, detail }]` (at most 20 examples a rule); an empty list means the exchange adds up.

  | Rule                | What must hold                                                                           |
  | ------------------- | ---------------------------------------------------------------------------------------- |
  | `money`             | Total cash plus the price of unsettled trades = number of users × $2,000                 |
  | `holds`             | Each user's held cash = the prices of their open WANTED ads                              |
  | `listedCopies`      | A copy is `listed` exactly when it has one open FOR SALE ad                              |
  | `askOwners`         | An open FOR SALE ad is for the seller's own copy, of that pressing                       |
  | `copiesInTrades`    | A copy is `in_trade` exactly when one unsettled trade has it                             |
  | `tradeCopies`       | Until a trade settles, its copy still belongs to the seller                              |
  | `filledOrders`      | An order is `filled` exactly when a trade names it                                       |
  | `tradesMatchOrders` | A trade agrees with its two orders: people, copy, pressing, a price both accepted, grade |
  | `uncrossed`         | No open WANTED ad could take an open FOR SALE ad from someone else                       |

  Rules the schema already enforces (one open ask per copy, `held <= cash`, targeted orders never rest) aren't
  repeated.

- **`npm run db:check`** runs the same check on the database in `.env` and exits with 1 if anything is broken. Run it
  after the demo bots (Part 8) or after any fix to the data by hand.
- **Startup**, `server/src/recovery.js`. `index.js` calls `recoverExchange(ctx)` after the migrations and before
  `listen`, so no order can arrive mid-rebuild:
  1. Check the rules. A broken rule is logged (`[check] holds: User 4 has $10.00 held, but …`), not fatal: one bad
     row shouldn't take the site down, and the log names the ids to look at.
  2. `ctx.orders.recover()` rebuilds every pressing's book in one query (`loadOpenOrders(db)` with no pressing) and
     logs `[orders] rebuilt N order books from M open orders`. A pressing whose orders the engine refuses is left out
     and named in the log; its next order fails the same way, so that pressing stops trading instead of trading on
     bad data, and every other pressing carries on.
- **The lazy load stays.** A book dropped after a failed transaction (Part 3) still reloads on its next order, through
  the same `buildBook` helper `recover()` uses.

## Tests

- `server/test/recovery.int.test.js`:
  - the rules hold on an empty exchange, on the demo data, and after a mix of matches, buys, sells to wanted ads,
    cancels, refunds and completed trades;
  - each rule catches the one thing that breaks it (the data is broken inside a transaction that's rolled back);
  - a restarted server rebuilds the same books, keeps price-time priority (equal prices fill oldest first, at the
    resting price), recovers from a trade that failed halfway, logs broken rules, and leaves out a pressing the engine
    refuses until it's fixed.
- **Every market test checks the exchange afterwards.** `orders`, `trades`, `room`, `market` and `collection` tests
  run `expectExchangeConsistent(ctx)` (`server/test/helpers.js`) after each test: the rules hold, and every book in
  memory equals the book the database would build. A test that changes data with SQL must keep the rules too: use
  `setCash(user, cents)` (`server/test/traders.js`) instead of setting `cash_cents`, and cancel an ad the way
  `OrderService` does (the copy goes back to the crate). Planting a bug in `OrderService` (a cancel that leaves the
  copy listed, a filled order left in the book) fails 20 tests.

## As built (several processes, concurrency and property-based tests)

- **Several server processes on one database** (migration 007, `OrderService`). Every order transaction takes
  `pg_advisory_xact_lock(release_id)` first, so processes take turns on a pressing just as requests in one process do
  (the in-process queue stays, so waiting requests don't hold database connections). It then reads the pressing's
  `book_versions` row: if this process's book is at an older version, another process changed the orders, and the
  book is reloaded under the lock before matching. The transaction bumps the version. `isCurrent(releaseId)` says
  whether a process's book is at the database's version.
- **The matching engine against a reference model** (`server/src/market/orderBook.property.test.js`, fast-check).
  1,500 random sequences of up to 60 orders, cancels and targeted orders, from 4 traders with few prices and grades
  so orders collide, tie and self-match often. After every step the book must equal a plain list kept by a separately
  written, obvious matcher: same trade, at the resting price, with the best eligible order (price, then time, then
  id); `match()` changes nothing; the book is never crossed; one ask per copy; targeted orders never rest. A second
  property: a book rebuilt with `add()` (restart) equals the live one. Planting a tie-break bug fails it with a
  shrunk two-order counterexample.
- **Concurrency against the real database** (`server/test/stress.int.test.js`), with two order services on two
  connection pools, like two processes:
  - a process whose book is behind reloads it and fills a WANTED ad it had never seen (fails without the version check);
  - fifteen buyers across both processes press Buy on one copy: exactly one trade, the rest `TARGET_UNAVAILABLE`;
  - every seller answers one WANTED ad at once: one sale, and the buyer's hold goes back to $0;
  - **random flow** (fast-check, 25 runs): up to 12 batches of up to 10 actions (bid, list, buy, sell to them, cancel,
    ship, accept, refund, cancel sale, and steps by the wrong person), each batch all at once across both processes.
    Only refusals (4xx) are allowed, and afterwards the rules hold and every current book equals the database.
- **The deadlock it found** (fixed): a purchase locked the buyer's wallet `FOR UPDATE` and then saved a trade, whose
  foreign key check needs a KEY SHARE lock on the seller's users row, while the seller's trade step held that row and
  waited for the buyer's wallet. Every row lock is now `FOR NO KEY UPDATE`, which still lets one transaction at a time
  change a wallet but lets foreign key checks through (rule added to `docs/PROJECT.md`). `deadlocks` in the stress
  tests reproduces it on demand: it fails with the old locks.
