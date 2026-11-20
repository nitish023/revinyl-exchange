# Part 17 (Sauransh): market surveillance

**Goal:** trades that look like wash trading (trading with yourself or a friend to fake a price or a volume) and sales
too far from every other one don't move the numbers the site shows, can't buy a seller level, and are reported.

## What's flagged (`server/src/analytics/surveillance.js`)

Within 30 days:

- **round_trip**: a copy comes back to someone who sold it (A→B→A, or round a ring A→B→C→A). Every leg on the way round
  is flagged: none of them moved the copy anywhere for real.
- **pair_churn**: the same two traders trade with each other three or more times, in either direction, inside any
  30-day stretch.

**Outliers** come from Part 13's fair value fit: a sale more than 3.5 robust standard deviations from the rest.

A flag is a reason to doubt a trade, not proof, so flagged trades still stand; they're only set aside from the numbers.

## Where it's used

- **Prices and models:** the pricing service builds fair value, the price history, the market-wide grade premium and
  the time-to-sale model only from clean sales (`loadSales` drops flagged trades per pressing).
- **Seller levels** (`sellerRecord.js`): a sale whose copy came back from the buyer within 30 days doesn't count, and at
  most two sales to any one buyer count per 90 days, so a seller can't wash-trade their way to a lower fee.
- **The report:** `GET /api/releases/:id/integrity` lists the flagged trades with their reasons, and the outliers,
  without naming anyone. On the pressing's page, under the appraisal, "Market integrity" says how many recent sales
  were left out and why, or that they all look like real trades.

## Tests

`surveillance.test.js` (A→B→A and a three-way ring, a return after 30 days isn't one, pair churn either way round, two
trades or a slow three aren't churn, and a property: a market where every copy only moves on and nobody trades with one
person three times is never flagged), `pricing.int.test.js` (a copy pumped to $200 and back between two friends is left
out of fair value and reported without names; an outlier is reported; the demo market is clean), `fees.int.test.js`
(five sales to one friend count as two; a bought-back copy doesn't count), and client tests for the note.
