# Part 19 (Sauransh): market-making bots and a market simulation

**Goal:** show, with numbers, what a market maker does for a market, then run real ones on the site, through the same
code and rules as everyone, clearly labelled. And give demos months of believable history.

## The quoting rule (`server/src/sim/marketMaker.js`)

After Avellaneda and Stoikov's model of a market maker ("High-frequency trading in a limit order book", 2008), adapted
to one-copy orders:

- **Reservation price** `r = fair × e^(−κ·(q − target))`: with more copies than it wants, the maker shades both quotes
  down (sell more, buy less); with fewer, up.
- **Spread** `δ = fair × (s₀ + c·σ)`: wider when prices are less certain (σ, the scatter of recent sales).
- **Quotes** `r ∓ δ/2`, in whole cents, at least $1, bid always under ask (a property test over all inputs).

## The mean-reversion rule (`server/src/sim/meanReversion.js`)

A second strategy, betting that prices which stray far from fair value come back. It measures the last sale's distance
from fair value in standard deviations, `z = ln(last ÷ fair) ÷ σ`: at `z ≤ −1` it bids 2% over that sale (buying the dip,
up to 3 copies); at `z ≥ 1` with stock it asks 2% under it (never below fair value); otherwise it offers what it holds at
fair value, taking the profit once the price is back.

## The simulation (`server/src/sim/simulation.js`, `npm run simulate`)

An agent-based market for one pressing, run on the real matching engine (`OrderBook`): the record's true value drifts
like a stock price (geometric Brownian motion) and nobody sees it; collectors arrive at random (Poisson), half to buy and
half to sell, each valuing the record around its true value and asking a little better for themselves; their orders
wait ten days and expire. The bots (each optional) learn value from the trades they see: the maker quotes every day; the
mean-reversion trader keeps a slower average and acts on big moves. Same seeds, same collectors, averaged over 50 seeds:

|                             | no bots | maker | reverter |  both |
| --------------------------- | ------: | ----: | -------: | ----: |
| Trades in 120 days          |   119.7 | 128.7 |    122.3 | 131.3 |
| Quoted spread               |    8.3% |  6.8% |     8.0% |  6.5% |
| Days an order waits to fill |    1.35 |  1.15 |     1.30 |  1.10 |
| Trade price vs true value   |   5.30% | 4.63% |    5.24% | 4.64% |

- The **market maker** made $25.41 on average (profitable in 48 of 50 runs), never holding more than 4 copies.
- The **mean-reversion trader** alone made $4.48 on average (profitable in 37 of 50), buying dips and selling them back.
- **Together**, the reverter breaks even (−$0.40, profitable in 29 of 50): the maker already keeps prices near value, so
  the dips it waits for are rarer. Liquidity provision and statistical arbitrage compete for the same mispricing.

The tests check these directions over 8 to 20 seeds.

## Live bots (`server/src/bots/botService.js`)

- Three bots, ordinary users flagged `is_bot` (migration 012) with random, discarded passwords: two market makers
  (`desk_marlowe`, `desk_okafor`) and a mean-reversion trader (`desk_sato`). They place, cancel and step trades through
  the order and trade services, so every rule applies to them.
- Every 30 seconds (`BOTS=off` turns them off): ship what they sold and accept what they bought once shipped; then, on
  the 12 busiest pressings, for the grade that sells most: a maker (pressings shared out between the two) keeps one
  WANTED ad and one FOR SALE ad at the rule's quotes for the pressing's fair value and spread (Part 13) and its stock,
  opening each pressing with two copies of stock; `desk_sato` applies its rule to the pressing's last sale. An ad is
  replaced only when its price moves more than 3%; ads run 7 days. On the live site a maker's standing bid catches a
  dip before the reverter can, just as in the simulation.
- Their ads say so: "desk_marlowe, a reVINYL trading bot." on a FOR SALE ad, "A reVINYL trading bot." on a WANTED ad.

## Demo history (`npm run db:simulate`, `npm run db:reset`)

- `db:simulate` writes 90 days of the simulation's trades into the database as finished sales (the seed's own
  `insertFinishedSale`: copies, filled orders, completed trades with the seller's fee, ledger journals), backdated, between
  24 simulated collectors, with grades in a record shop's mix. The history is **anchored** so its last two weeks average
  the pressing's fair value today, and collectors are paired so nobody churns, so surveillance has nothing to flag.
- `db:reset` (refuses in production) empties a local database and puts back the demo seed and the simulated history.
- Price statistics (Part 14) now measure volatility and the 30-day change on **weekly** averages: individual copies
  scatter ±15% for reasons that aren't the market, and sale-to-sale that read as over 100% volatility a month. On the
  demo: ±8% a month, +5% over 30 days, nothing flagged, the reVINYL 30 at about 1,200 over 90 days.

## Tests

`marketMaker.test.js`, `simulation.test.js` (deterministic per seed; with a maker: narrower spread, more trades, less
waiting, closer to true value, profitable, bounded stock), `bots.int.test.js` (made once; nothing to do without sales;
a bid under fair value and an ask over it; no churn; ships and accepts; labelled on the market; simulated history is
consistent, clean, believable and runs once), and the market labels in the client tests.
