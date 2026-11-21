# Part 18 (Sauransh): the reVINYL 30 and portfolios

**Goal:** one number for how the record market is doing, built the way a stock index is, and for each trader a
portfolio: what their records are worth, what they paid and what they've made.

## The reVINYL 30 (`server/src/analytics/marketIndex.js`)

- **Members:** the 30 pressings with the most money traded in the 90 days before each rebalance, from clean sales only
  (Part 17's flagged trades don't count).
- **Prices:** each member's latest sale restated as a VG+ copy (Part 14), carried forward on days it doesn't trade.
- **Weights:** by traded value. At a rebalance each member gets shares `q = 90-day traded value ÷ price`, so its share of
  the index is its share of the money traded; between rebalances the shares stay put and weights drift with prices,
  as in a cap-weighted index.
- **Level:** `Σ q·price ÷ divisor`, starting at **1,000**. Rebalanced weekly; at each rebalance the **divisor is reset**
  so the level is the same with the new members that day. Only price changes move the index, never a change of
  membership.
- Tests: it follows a single pressing (+50% → 1,500); weights by traded value as of the last rebalance; a pressing
  joining at a rebalance doesn't move the level; only the biggest are kept; and a property over random markets: if every
  member's price doubles, the index doubles, whatever the membership.

## Portfolios (`server/src/analytics/portfolio.js`, `reports.js`)

- **Cost basis by specific identification:** every copy is unique, so a copy's cost is what you paid for that very copy
  on reVINYL (no FIFO needed). A copy you added by hand or imported has no cost basis: it counts towards what your
  records are worth, not towards gains.
- **Holdings:** your copies (in the crate, for sale, up for auction, or sold and not yet paid out) and copies you've
  bought that are on their way, each **marked to fair value** (Part 13) for its grade.
- **Unrealized** = fair value − cost; **realized** = what a sale paid you (price − the seller's fee) − what that copy
  cost you, with how long you held it; **return** = (realized + unrealized) ÷ the cost of those positions; **net worth**
  = cash + holdings at fair value.

## As built

- `GET /api/index` (anyone) and `GET /api/portfolio` (you). The pricing service gained `fairValues(releaseIds)` and
  `vgPlusSales()`.
- Front page: **The reVINYL 30**: the level and its 30-day change, a line over 90 days, the ten biggest members with
  weights and VG+ prices, and how it's built in a paragraph.
- Listening Room: **Your portfolio**: a summary sentence (net worth, gains on paper and from sales, return, records with
  no fair value yet), **net worth over the last 90 days** as a line, your records with cost, fair value and gain, and
  your sales with what each paid you, what it cost and the gain.
- **Net worth over time** (`portfolioSeries`): for each day, cash from the ledger at the end of that day, plus every copy
  owned that day (from each copy's trade history: the buyer owns it from the moment they pay, so a copy in the post
  counts for them) at its pressing's level then: a VG+ copy's weekly average price, carried through quiet weeks, moved
  to the copy's grade. A pressing that hasn't sold yet adds nothing.
- Tests: `marketIndex.test.js`, `portfolio.test.js`, `reports.int.test.js` (the index from two pressings weighted 75/25;
  holdings at fair value with and without cost; a copy bought at $40 and sold at $60 realizes $12.80 after the 12% fee;
  a copy on its way; login required), client tests, and the browser.
