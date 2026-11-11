# reVINYL project rules and build plan

Read this before you start a part. If a rule needs to change, change it here in the same PR.

## Ground rules

- **Course rules:** HTML, CSS and JavaScript only, no front-end frameworks (no React, Vue, Angular, jQuery UI kits).
  Vite is only the dev server and bundler.
- **Plain JavaScript** with ES modules. Imports use the full file name with `.js`. Use JSDoc comments for the shapes
  of objects that cross files (see `shared/catalog.js`).
- **Rules live in `shared/`** (grades, schemas, limits) so the form in the browser and the server agree and show the
  same messages. The server always re-checks; the browser check is only for speed.
- **Errors:** throw `AppError(status, code, message, fields)` from `server/src/errors.js`. Anything else becomes a
  generic 500 with no details. Every error response is `{ "error": { "code", "message", "fields"? } }`.
- **Market tables** (migration 003, shared by Parts 3 to 6): `users.cash_cents` / `held_cents` (spendable is cash
  minus held), `copies` (grade, sleeve grade, condition flags, status `in_crate` / `listed` / `in_trade`),
  `copy_photos`, `orders` (one open ask per copy) and `trades`. bigint columns come back from pg as numbers.
  A removed copy keeps its row (old orders and trades point at it) and gets `copies.removed_at` (migration 004):
  leave out `removed_at IS NOT NULL` copies anywhere you list a user's records.
- **Orders go through `ctx.orders`** (`server/src/orders/orderService.js`): never write `orders`, held cash or a
  copy's status from anywhere else, or the in-memory book stops matching the database.
- **Live updates:** after a commit that changes a pressing's market, call `ctx.live.marketChanged(releaseId)`, and
  `ctx.live.notifyUser(userId, message)` for private changes. Never before the commit.
- **Database:** plain SQL with `$1` parameters, never string-built SQL. A schema change is a new numbered file in
  `server/migrations/` (never edit one that has run anywhere). Use `withTransaction` from `server/src/db/pool.js` when
  more than one write must succeed together.
- **Money** is whole cents as JavaScript numbers (`4050` = $40.50). The API sends prices as strings like `"40.50"`.
  Never use floating-point dollars. Starting play cash is $2,000 (Part 3).
- **Security:** passwords are hashed with scrypt; the session cookie is httpOnly and SameSite=Lax and the database
  stores only a hash of it; `sameOrigin` blocks changes sent from other websites; Helmet sets the CSP. Routes that need
  a login use `requireUser`. Never send another user's email, and never show anyone's location.
- **Tests:** unit tests next to the code (`*.test.js`), API tests in `server/test/*.int.test.js`. Every part adds
  tests for its rules. `npm run test:all` and `npm run lint` pass before a PR is merged.
- **Git:** one branch and one PR per part (`nitish/part-4-market`), reviewed by the other person. Commit messages:
  `type(scope): description` (feat, fix, refactor, test, docs, chore).

## Catalog (Discogs)

1. Only the server talks to Discogs (`server/src/catalog/`). The token is `DISCOGS_TOKEN`, never in the browser, the
   repo or logs. Every call goes through `DiscogsClient`, which shares one rate window (30 a minute; Discogs allows 60)
   and pauses for a minute after a 429.
2. Pressings are cached in `releases` and refreshed after `CATALOG_MAX_AGE_HOURS`. Anything that refers to a pressing
   (copies, orders, trades) calls `ctx.catalog.ensureRelease(id)` first and uses `releases(id)` as its foreign key.
3. Vinyl only. Never store or show Discogs marketplace prices: our prices come only from our own trades.
4. Pages that show Discogs data credit it with a link and say we're not affiliated (the footer does this on every
   page). Covers load from `https://i.discogs.com` only (allowed in the CSP in `server/src/app.js`).

## Design: "The Paper"

reVINYL looks like a 1960s/70s newspaper with Sunday-edition spacing. The approved boards are on the team's design
canvas (page "The Paper", v2 row). Reuse what's in `client/src/styles.css` instead of adding new styles: the masthead,
`.kicker`, `.headline`, `.banner`, `.deck`, `.label`, `.section-head`, `.rule-double`, `.button` (`--quiet`,
`--block`), `.coupon` (the dashed clip-out box for forms), `.field` and `.input`, `.record-grid` and `.record-card`,
`cover()` and `gradeScale()`.

- Fonts (bundled, no Google Fonts): Old Standard TT for headlines and prices, League Gothic for section titles, Libre
  Franklin for labels and tables, Merriweather for body text.
- Only newsprint and ink colors. Covers are the only color: they print black and white and turn to color on hover or
  keyboard focus while the record slides out. `--spot-red` is for errors only.
- Copies for sale are FOR SALE ads and bids are WANTED ads. Buyers show as "Buyer, 9 trades", never a name or place.
- Every hover effect also works with the keyboard, and `prefers-reduced-motion` turns animation off.

## API so far

| Method | Path                                                                                                  | Who    | Part |
| ------ | ----------------------------------------------------------------------------------------------------- | ------ | ---- |
| GET    | `/api/health`                                                                                         | anyone | 2    |
| POST   | `/api/auth/register` `{ email, displayName, password }`                                               | anyone | 2    |
| POST   | `/api/auth/login` `{ email, password }`                                                               | anyone | 2    |
| POST   | `/api/auth/logout`                                                                                    | anyone | 2    |
| GET    | `/api/auth/me`                                                                                        | anyone | 2    |
| GET    | `/api/catalog/search?q=&page=&format=lp\|12in\|7in&year=`                                             | anyone | 2    |
| GET    | `/api/releases/:id`                                                                                   | anyone | 2    |
| GET    | `/api/wallet`                                                                                         | user   | 3    |
| GET    | `/api/crate?releaseId=`                                                                               | user   | 3    |
| POST   | `/api/crate` `{ releaseId, grade, sleeveGrade, flags, headline, notes }`                              | user   | 3    |
| DELETE | `/api/crate/:id`                                                                                      | user   | 3    |
| POST   | `/api/crate/:id/photos` (the image as the body)                                                       | user   | 3    |
| GET    | `/api/copies/:id/photos/:position`                                                                    | anyone | 3    |
| GET    | `/api/orders?status=open\|filled\|cancelled&releaseId=`                                               | user   | 3    |
| POST   | `/api/orders` `{ side: 'bid', releaseId, price, minGrade, note }` or `{ side: 'ask', copyId, price }` | user   | 3    |
| DELETE | `/api/orders/:id`                                                                                     | user   | 3    |
| GET    | `/api/releases/:id/market` (+ `mine.orderIds` if logged in)                                           | anyone | 4    |
| WS     | `/ws` subscribe / unsubscribe to a pressing's market (`shared/market.js`)                             | anyone | 4    |

Planned: buy and sell-to routes and trade states (Part 5, see `docs/parts/part-5-trades.md`), the Discogs collection
import and the Listening Room (Part 6).

## Build plan

Ten parts, one per person per week. Each part's brief lives in `docs/parts/`.

| Week | #   | Owner    | Part                                                                                     | Status  |
| ---- | --- | -------- | ---------------------------------------------------------------------------------------- | ------- |
| 7    | 1   | Sauransh | Matching engine: order book per pressing, grade filter, priority rules, order rules      | ✅ done |
| 7    | 2   | Nitish   | Repo setup, login and sign up, Discogs catalog, newspaper design and page shell, Neon    | ✅ done |
| 8    | 3   | Sauransh | Crate, listings and wanted ads, held cash ($2,000 start, seller notes, cancel)           | ✅ done |
| 8    | 4   | Nitish   | The Market: classifieds by grade, wanted ads, Market Report, live updates over WebSocket | ✅ done |
| 9    | 5   | Sauransh | Buying from an ad, selling to a wanted ad, trade lifecycle (ship, check, refund)         | ☐       |
| 9    | 6   | Nitish   | Discogs collection import and the Listening Room (shelf, wanted ads, ledger)             | ☐       |
| 10   | 7   | Sauransh | Restart recovery, concurrency and property-based invariant tests                         | ☐       |
| 10   | 8   | Nitish   | Demo bots, the front page (lead record, First Shelf) and the reVINYL 30 chart            | ☐       |
| 11   | 9   | Sauransh | Security pass and accessibility pass (stretch: mutation testing)                         | ☐       |
| 11   | 10  | Nitish   | Production deploy, phone layouts, README setup, demo accounts and demo script            | ☐       |
