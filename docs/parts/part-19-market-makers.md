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

## The simulation (`server/src/sim/simulation.js`, `npm run simulate`)

An agent-based market for one pressing, run on the real matching engine (`OrderBook`): the record's true value drifts
like a stock price (geometric Brownian motion) and nobody sees it; collectors arrive at random (Poisson), half to buy and
half to sell, each valuing the record around its true value and asking a little better for themselves; their orders
wait ten days and expire. The maker (optional) learns value from the trades it sees and quotes every day. Same seed,
same collectors, with and without it, averaged over 50 seeds:

|                             | without | with a maker |
| --------------------------- | ------: | -----------: |
| Trades in 120 days          |   119.7 |        128.7 |
| Quoted spread               |    8.3% |         6.8% |
| Days an order waits to fill |    1.35 |         1.15 |
| Trade price vs true value   |    5.3% |         4.6% |

The maker made $25.41 on average (profitable in 48 of 50 runs) and never held more than 4 copies. The tests check the
same directions over 8 seeds.

## Live bots (`server/src/bots/botService.js`)

- Two bots (`desk_marlowe`, `desk_okafor`), ordinary users flagged `is_bot` (migration 012) with random, discarded
  passwords. They place, cancel and step trades through the order and trade services, so every rule applies to them.
- Every 30 seconds (`BOTS=off` turns them off): ship what they sold and accept what they bought once shipped; then, on
  the 12 busiest pressings (shared out between the bots), for the grade that sells most, keep one WANTED ad and one FOR
  SALE ad at the rule's quotes for the pressing's fair value and spread (Part 13) and the bot's stock. An ad is replaced
  only when its quote moves more than 3%; ads run 7 days. A bot opens each pressing with two copies of stock.
- Their ads say so: "desk_marlowe, reVINYL's market maker." on a FOR SALE ad, "reVINYL's market maker." on a WANTED ad.

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
