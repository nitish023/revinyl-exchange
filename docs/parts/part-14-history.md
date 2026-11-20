# Part 14 (Sauransh): price history and the book

**Goal:** a pressing's page charts its prices the way a stock's would (daily candles, volatility, the 30-day change, the
52-week range) and shows its order book as a depth chart, without mixing up grades.

## Grades first

Sales of different grades can't share a chart as they are: a Mint copy at $60 after a VG at $20 isn't the price
tripling. Every sale is restated as its **VG+ equivalent**, `price × e^(−b·(grade − VG+))`, with `b` the pressing's
fitted grade premium from Part 13 (the market's where the pressing has no sales).

The book is shown **one grade at a time**: copies of exactly that grade for sale, against the WANTED ads that would take
a copy of that grade (lowest grade at or below it). Across all grades a $17 "VG+ or better" ad and a $7 G+ copy would
read as a −$10 spread, but they can never trade. Within one grade the engine keeps the book uncrossed: a wanted ad and
a copy from different traders that met would already have traded (a property test builds books with the real engine
from random order flow and checks exactly that; one trader's own ad and copy can meet, since nobody trades with
themselves).

## As built (`server/src/analytics/history.js`)

- `dailyCandles(sales, b)`: one candle per UTC day with sales (open, high, low, close in VG+ terms, and how many).
- `priceStats(candles, now)`: **volatility** is the standard deviation of the log change from one trading day's close
  to the next, each divided by √(days between) so a quiet gap doesn't look calm, stated for a month (× √30); the
  **30-day change** against the last close at least 30 days ago; the **52-week high and low**.
- `depth(bids, asks)` and `depthByGrade`: each side as a cumulative staircase from its best price outwards (copies
  wanted at a price or more; copies for sale at a price or less), and the spread with its share of the cheapest copy.
- `GET /api/releases/:id/history` (`PricingService.history`): candles, stats, and one book per grade.
- Release page, **Price history**: a one-line summary, a candle chart (time axis, so gaps between trading days show;
  hollow up days, filled down days, the day's sales as bars), then **The book**: grade buttons (the busiest grade first,
  kept through refreshes), a depth chart (wanted ads shaded, copies for sale hatched) and a sentence with the spread.
  Plain SVG in the paper's one ink; each chart has a spoken description (`role="img"` and `aria-label`). It refreshes
  a second after the market changes.
- Tests: `history.test.js` (VG+ restating, candles, volatility including the √gap scaling, the 30-day change and
  52-week range, staircases, the per-grade book and the uncrossed property), `charts.test.js` (nice ticks, the time
  axis, candle shapes, depth paths, wording), `priceHistory.test.js` (charts, descriptions, the grade buttons), the API
  in `pricing.int.test.js`, and the browser at desktop and phone widths.
