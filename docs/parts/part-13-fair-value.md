# Part 13 (Sauransh): fair value per grade, suggested prices and the chance of selling

**Goal:** every pressing's page says what a copy is worth in each grade, with an honest range, even for grades that
have never sold; and a seller pricing a copy sees how likely their price is to sell, with three suggested prices.

## Fair value (`server/src/analytics/fairValue.js`)

StockX shows the last sale. One sale says little and most grades never sell, so every sale informs every grade
through one model: `ln(price) = a + b·(grade − VG+)`, where `b` is the grade premium (each grade up multiplies the price
by e^b).

- **Weighted least squares**, a sale's weight halving every **30 days**, so the estimate follows the market.
- **Shrinkage (empirical Bayes):** `b` is pulled towards the premium learned across the whole market
  (`pooledGradeStep`: within each pressing, how log price moves with grade, pooled; shrunk to +30% with little data),
  as if two extra sales agreed with it. One sale of one grade still prices every other grade sensibly.
- **Monotone:** `b ≥ 0`, so a better copy is never worth less.
- **Robust:** after a first fit, a sale more than **3.5 MADs** (robust standard deviations) from the median residual is
  set aside and the model refitted, so one silly or suspicious price can't drag fair value (Part 17 adds wash trades).
- **80% prediction intervals** from the scatter around the line (blended with a prior spread while data is thin) plus
  the line's own uncertainty, which grows away from the grades that sold. Tested to hold ~80% of new sales.

## The chance of selling (`server/src/analytics/saleOdds.js`, `shared/pricing.js`)

A **survival model**. Every past FOR SALE ad is one observation: days up, and whether it sold or was cancelled or is
still up (**censored**: we only know it hadn't sold yet; dropping those would make every price look like it sells; a
test shows exactly that bias). Each ad sells at a constant daily rate depending on its price relative to fair value:
`rate = exp(α + β·ln(price / fair))`. The log-likelihood is concave, so **Newton's method** (with step halving) finds
the maximum in a few iterations; a gentle normal prior (a fair ad sells in ~10 days; 10% over fair cuts the rate by a
third) keeps it sensible with few ads. The chance of selling within `d` days is `1 − exp(−rate·d)`.

**Suggested prices** (`suggestPrices`): **quick** (the highest price with a 90% chance within a week, at most 95% of fair
value: always a discount), **fair**, and **patient** (the price with the most expected money within 30 days, price ×
chance, found on a 1% grid from half to twice fair value).

## As built

- `PricingService` (`ctx.pricing`): the market-wide premium and the sale-odds fit are learned from every sale and every
  past ad and cached for a minute; a pressing's own fit runs per request. `GET /api/releases/:id/pricing` (public).
- Release page: **The appraisal**, every grade best first with fair value, the 80% range and its sales (grades that
  sold in bold), and a sentence on the premium, the half-life and any sales set aside. It refreshes after a new sale.
- Sell form: picking a copy shows its fair value and range and three price buttons ("Quick sale $15.28 · 91% within a
  week"); typing a price says the chance it sells within a week and a month, and (Part 12) what you'd be paid.
- Tests: synthetic sales from a known model (recovers the level and premium; the 80% ranges hold 72 to 90% of 4,000
  new sales; one sale prices every grade; a wild sale is set aside; recent sales count more; never a better grade
  below a worse one, as a property over random sales), the survival fit (recovers α and β from 4,000 censored ads;
  the bias without censoring; the prior with no data), suggestions, the API (`pricing.int.test.js`), and the browser.
