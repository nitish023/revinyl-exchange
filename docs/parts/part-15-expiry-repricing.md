# Part 15 (Sauransh): ads that expire, and "stay on top" repricing

**Goal:** ads don't run forever (WANTED ads expire after 30 days unless the buyer picks otherwise, as StockX bids do),
and a trader can set a rule that keeps their ad the best one on its grade without watching the market.

## Expiry

- Migration 010: `orders.expires_at` and a new status, `expired`. `POST /api/orders` takes `expiresInDays`: 7, 30, 60 or
  90, or `null` for "until I cancel it". WANTED ads default to 30 days, FOR SALE ads to until-cancelled. Targeted orders
  never rest, so they never have one (a CHECK constraint).
- **Exactly on time:** every order transaction on a pressing (`#transaction`, under the pressing's advisory lock)
  first expires its ads whose time is up, closing them like a cancel (a bid's hold goes back, an ask's copy goes to the
  crate) and rebuilding the book, so an expired ad can never match. Owners are told (`order` … `expired`).
- **Quiet pressings:** `OrderService.sweepExpired()` runs at start and once a minute (`index.js`). It runs an empty
  transaction on each pressing with ads due, which expires them the same way.
- The exchange rules gained `expiry`: no ad open more than 10 minutes past its time.

## "Stay on top" rules (`server/src/orders/repricing.js`)

- `repriceStep` and `repriceLimit` (both or neither; parsed from dollars). A FOR SALE ad keeps itself the cheapest copy
  of its grade: when another seller lists that grade for less, it drops to a step under them, never below its floor.
  A WANTED ad keeps itself the best offer for its lowest grade, rising a step over a higher offer, never above its
  ceiling. Validated in `shared/orders.js` (a floor can't be above the price, a ceiling can't be below it).
- **When:** after every change on a pressing, still inside that pressing's turn of the queue, `#runRules` lets the
  rules react one move at a time until none wants to move (at most 25 moves a turn; the next change carries on).
- **How a price moves:** cancel and replace in one transaction (`#replace`): the old ad closes, a new order with the
  same copy or grade, rule and expiry goes in at the new price (`replaces_order_id` links them) and matches like any
  order, so a lowered ad that meets a WANTED ad sells. As on a real exchange, a new price is a new place in the queue.
  A WANTED ad that can't cover its higher price stays where it is for that turn.
- **Price wars end:** a rule only ever moves a price towards a sale (asks down, bids up), by at least a cent, between
  bounds; a property test runs random wars between several rules and checks they always stop, with nobody able to
  undercut a rival without breaking their floor.

## Browser

Both ad coupons have "The ad runs for" and the two rule fields; "Your ads on this pressing" says e.g. "Runs to Nov 27 ·
stays $1.00 under cheaper copies, down to $25.00".

## Tests

`repricing.test.js` (targets, other grades and own ads ignored, ceilings and floors, price wars end), `expiry.int.test.js`
(defaults; refused lengths; an expired WANTED ad never fills and its hold comes back; the sweep on a quiet pressing;
following a rival down to the floor; a lowered ad that meets a WANTED ad sells at its price; a WANTED ad rising to its
ceiling and holding the cash; one that can't afford to rise; a two-rule price war; validation), the stress test's random
flow now also places ads with rules and makes ads expire across both processes, and client tests for the fields.
