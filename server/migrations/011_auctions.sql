-- Sealed-bid second-price auctions (Part 16). A seller puts one copy up with a reserve; bids
-- are sealed (only the count is public) and each holds its amount from the bidder's cash,
-- like a WANTED ad, so the winner can always pay. At the end the highest bid wins and pays
-- the second-highest (or the reserve), and the auction settles into an ordinary trade.

-- A copy up for auction is in neither the crate nor the classifieds.
ALTER TABLE copies DROP CONSTRAINT copies_status_check;
ALTER TABLE copies
  ADD CONSTRAINT copies_status_check CHECK (status IN ('in_crate', 'listed', 'in_trade', 'in_auction'));

CREATE TABLE auctions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id     bigint NOT NULL REFERENCES users (id),
  release_id    bigint NOT NULL REFERENCES releases (id),
  copy_id       bigint NOT NULL REFERENCES copies (id),
  reserve_cents integer NOT NULL CHECK (reserve_cents BETWEEN 100 AND 1000000),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'unsold', 'cancelled')),
  ends_at       timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  trade_id      bigint UNIQUE REFERENCES trades (id),
  CONSTRAINT auctions_closed_at CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT auctions_sold_trade CHECK ((status = 'sold') = (trade_id IS NOT NULL)),
  CONSTRAINT auctions_ends_after_start CHECK (ends_at > created_at)
);
CREATE UNIQUE INDEX auctions_one_open_per_copy ON auctions (copy_id) WHERE status = 'open';
CREATE INDEX auctions_open_by_release ON auctions (release_id) WHERE status = 'open';
CREATE INDEX auctions_open_ending ON auctions (ends_at) WHERE status = 'open';

-- One live bid per bidder per auction; raising it replaces the amount (and the hold).
CREATE TABLE auction_bids (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id   bigint NOT NULL REFERENCES auctions (id),
  bidder_id    bigint NOT NULL REFERENCES users (id),
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 1000000),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auction_id, bidder_id)
);
CREATE INDEX auction_bids_bidder ON auction_bids (bidder_id) WHERE status = 'active';
