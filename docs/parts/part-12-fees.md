# Part 12 (Sauransh): seller fees, levels and reliability

**Goal:** sellers pay a fee like they do on StockX, lower the more they sell and the more reliable they are, with
every cent accounted for in the ledger, and buyers see how reliable a seller is before they buy.

## The rules (`shared/fees.js`, used by the browser and the server)

| Level | Transaction fee | + processing | Total | Needs, in the last 90 days         | And a trust score of |
| ----- | --------------- | ------------ | ----- | ---------------------------------- | -------------------- |
| 1     | 9%              | 3%           | 12%   |                                    |                      |
| 2     | 8.5%            | 3%           | 11.5% | 3 completed sales and $100 of them |                      |
| 3     | 8%              | 3%           | 11%   | 10 sales and $500                  |                      |
| 4     | 7.5%            | 3%           | 10.5% | 25 sales and $1,500                | 80                   |
| 5     | 7%              | 3%           | 10%   | 50 sales and $4,000                | 90                   |

- **The buyer pays exactly the price.** The seller's fee is fixed **when the trade is made** (`trades.seller_fee_cents`,
  at their level then) and taken out of the payout when the buyer accepts the record: the ledger's `trade_payout`
  posts escrow −price, seller +(price − fee), fees +fee. A refunded trade costs the seller nothing.
- **Exact cents.** Each part of the fee is `price × basis points / 10,000`, rounded **half to even** (banker's
  rounding: $1.215 → $1.22, $1.225 → $1.22) with integer arithmetic only. Rounding every half up would overcharge
  sellers a fraction of a cent on average; half-to-even comes out even.
- **Levels** count completed sales by the day they settled, over a rolling 90 days. A seller is at the highest level
  whose every threshold they meet, so volume alone can't buy the top levels.
- **Trust score** is the lower bound of the 95% **Wilson score interval** of completed / (completed + refunded) sales:
  how reliable a seller is at least, given how much evidence there is. 3 out of 3 scores 44, 98 out of 100 scores 93.
  A plain percentage would rank a seller with one sale above one with a long record.
- **What buyers see** on an ad is the plain rate, "98% of sales completed" (after three settled sales; "New seller"
  until then), which reads better; the Wilson score decides levels and is explained to the seller in their room.

## As built

- `shared/fees.js`: `roundHalfEven`, `basisPoints`, `payoutFor(price, level)`, `wilsonLowerBound`, `reliabilityOf`,
  `standingOf(record)` (level, fee and what the next level needs), `reliabilityText`, `trustScoreText`, `percentText`.
- `server/src/sellers/sellerRecord.js`: `loadSellerRecord` (one query over the seller's trades), `sellerFeeFor` (called
  inside the trade's transaction by `recordTrade`, and by the demo seed), `loadStanding`; `GET /api/seller`.
- Migration 009: every settled trade has `settled_at` and every shipped one `shipped_at` (filled in for old demo data,
  then required by CHECK constraints), since levels count sales by `settled_at`.
- Ads: the market query reads each seller's completed and refunded sales; `seller.reliability` is the plain rate.
- Browser: "Sell your copy" says what you'll be paid as you type the price; "Sell to them" says it beside the copy
  picker; the Listening Room's "You as a seller" box has your level, fee, trust score, what the next level needs and
  the whole ladder.
- Tests: `shared/fees.test.js` (rounding, including that half-to-even has no drift; property tests that fee + payout =
  price for every price and level, that a higher level never pays more; published Wilson values; level thresholds),
  `server/test/fees.int.test.js` (12% for a new seller; level 2 after three sales; the fee fixed at sale time even if the
  seller levels up before payout; the 90-day window; refunds cost nothing and lower the score; ads), and client tests
  for the payout line and the standing text. Every market test's money check now includes the fees account.
