# Part 16 (Sauransh): sealed-bid second-price auctions

**Goal:** a seller can auction a single copy (a rare pressing, say) instead of naming a price, in a format where every
bidder's best move is simply to bid what the copy is worth to them.

## The mechanism (`shared/auctions.js`)

A **Vickrey auction**: bids are sealed (only how many there are is public); when it ends, the highest bid at or above the
reserve wins and pays the **second-highest bid**, or the reserve if that's more. Ties go to the earlier bid. Because
the winner never pays their own bid, bidding your true value is a **weakly dominant strategy**: bidding less only risks
losing a copy you'd have paid less than its worth for, and bidding more only risks winning above its worth.
`auctions.test.js` checks this as a property over 3,000 random cases (any value, any other bid, any rival bids, any
reserve: bidding your value never does worse), and shows why a first-price auction rewards shading instead.

## As built

- Migration 011: `auctions` (seller, copy, reserve, status `open`/`sold`/`unsold`/`cancelled`, `ends_at`, the trade
  it settled into) and `auction_bids` (one live bid per bidder; raising replaces it). A copy up for auction has a new
  status, `in_auction`: it can't be listed, sold to a wanted ad, removed or auctioned twice.
- `AuctionService` (`ctx.auctions`):
  - `start`: a copy from your crate, a reserve and 1, 3 or 7 days.
  - `bid`: a sealed bid at or above the reserve, or a higher one; the amount is **held** from your cash like a WANTED
    ad (raising holds only the difference), so the winner can always pay and nobody bids the same dollars twice.
  - `cancel`: the seller, while nobody has bid.
  - `settle` / `settleDue` (on the once-a-minute sweep): every hold is released; the winner pays the clearing price
    into escrow; the result is recorded as the two orders that met (the seller's at the reserve, the winner's at their
    sealed bid) and an ordinary **trade** between them, so shipping, the buyer's check, the seller's fee and payout,
    the ledger and the Listening Room all work unchanged. Settling twice at once (two processes) settles once.
  - Locks: the auction row, then wallets in id order, then the copy; order transactions never lock a copy up for
    auction, so the two can't deadlock.
- API: `GET /api/releases/:id/auctions`, `POST /api/auctions`, `GET /api/auctions/:id`, `POST /api/auctions/:id/bids`,
  `DELETE /api/auctions/:id`. Amounts are never sent to anyone but their bidder; results show the clearing price.
- Exchange rules: `holds` now includes live auction bids; `auctionCopies` (in_auction ⇔ one open auction of the
  owner's), `auctionBids` (live exactly while open, never under the reserve), `auctionPrices` (every sold auction went
  to its highest bid at the second price; planting a first-price bug fails it in every test that sells).
- Browser: an "Auction your copy" coupon, and an **Auctions** section on each pressing: how it works in one paragraph,
  each open auction with its sealed bid count and a bid form (your own bid shown to you), "Take it down" for the
  seller, and recent results ("Sold for $48.00 after 3 sealed bids").
- Tests: the mechanism and the honesty property, `auctions.int.test.js` (starting, sealed visibility, raising, every
  refusal, second price, a lone bid pays the reserve, unsold, eight bidders and two settlements at once, taking it
  down), the stress test's random flow now starts, bids on and ends auctions across both processes, client tests,
  and the browser (a seller and two bidders through the page; the $31 bid won and paid $24).
