-- The market: wallets, copies in crates, orders (FOR SALE and WANTED ads) and trades.
-- Shared by Part 3 (crate, orders, holds) and Part 4 (the market page). Money is whole
-- cents. Ids are bigint like users.id; server/src/db/pool.js reads bigint as a JS number.

-- Wallet. cash_cents is everything the user has; held_cents is the part set aside for
-- open WANTED ads. Spendable money is cash_cents - held_cents. Everyone starts with $2,000.
ALTER TABLE users
  ADD COLUMN cash_cents bigint NOT NULL DEFAULT 200000,
  ADD COLUMN held_cents bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT users_wallet_check CHECK (held_cents >= 0 AND held_cents <= cash_cents);

-- One physical record someone owns. grade and sleeve_grade use the ranks in
-- shared/grades.js (1 Poor ... 8 Mint). A NULL sleeve_grade means a generic or missing
-- sleeve. flags are the codes in shared/copies.js (CONDITION_FLAGS). Matching only ever
-- looks at grade.
CREATE TABLE copies (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id     bigint NOT NULL REFERENCES users (id),
  release_id   bigint NOT NULL REFERENCES releases (id),
  grade        smallint NOT NULL CHECK (grade BETWEEN 1 AND 8),
  sleeve_grade smallint CHECK (sleeve_grade BETWEEN 1 AND 8),
  flags        text[] NOT NULL DEFAULT '{}'
               CHECK (flags <@ ARRAY['warp', 'skips', 'groove_wear', 'ring_wear', 'seam_split',
                                     'label_writing']::text[]),
  headline     text NOT NULL DEFAULT '' CHECK (length(headline) <= 40),
  notes        text NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  status       text NOT NULL DEFAULT 'in_crate' CHECK (status IN ('in_crate', 'listed', 'in_trade')),
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'discogs_import')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX copies_owner_id_idx ON copies (owner_id);
CREATE INDEX copies_release_id_idx ON copies (release_id);

-- Up to six photos per copy, stored in the database because Render's free disk is wiped
-- on every deploy. Kept out of `copies` so listing copies never loads image bytes.
CREATE TABLE copy_photos (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  copy_id      bigint NOT NULL REFERENCES copies (id) ON DELETE CASCADE,
  position     smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes        bytea NOT NULL CHECK (octet_length(bytes) <= 2097152),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (copy_id, position)
);

-- A bid is a WANTED ad (max price + lowest grade accepted); an ask is a FOR SALE ad for
-- one copy. Every order is for exactly one copy. A targeted order ("Buy this copy",
-- "Sell to them", Part 5) names the one resting order it may match, and never rests.
CREATE TABLE orders (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         bigint NOT NULL REFERENCES users (id),
  release_id      bigint NOT NULL REFERENCES releases (id),
  side            text NOT NULL CHECK (side IN ('bid', 'ask')),
  price_cents     integer NOT NULL CHECK (price_cents BETWEEN 100 AND 1000000),
  min_grade       smallint CHECK (min_grade BETWEEN 1 AND 8),
  copy_id         bigint REFERENCES copies (id),
  note            text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  target_order_id bigint REFERENCES orders (id),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  CONSTRAINT orders_side_fields CHECK (
    (side = 'bid' AND min_grade IS NOT NULL AND copy_id IS NULL) OR
    (side = 'ask' AND copy_id IS NOT NULL AND min_grade IS NULL)
  ),
  CONSTRAINT orders_closed_at CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT orders_targeted_never_rest CHECK (target_order_id IS NULL OR status <> 'open')
);
-- The database's own guarantee that a copy can't be for sale twice.
CREATE UNIQUE INDEX orders_one_open_ask_per_copy ON orders (copy_id)
  WHERE side = 'ask' AND status = 'open';
CREATE INDEX orders_open_by_release_idx ON orders (release_id) WHERE status = 'open';
CREATE INDEX orders_user_id_idx ON orders (user_id, status);

-- A match between one bid and one ask, at the resting order's price. The buyer pays when
-- the trade is made; the money is held by reVINYL until the buyer checks the record
-- (Part 5), then goes to the seller, or back to the buyer on a refund.
CREATE TABLE trades (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id   bigint NOT NULL REFERENCES releases (id),
  copy_id      bigint NOT NULL REFERENCES copies (id),
  grade        smallint NOT NULL CHECK (grade BETWEEN 1 AND 8),
  price_cents  integer NOT NULL CHECK (price_cents BETWEEN 100 AND 1000000),
  bid_order_id bigint NOT NULL UNIQUE REFERENCES orders (id),
  ask_order_id bigint NOT NULL UNIQUE REFERENCES orders (id),
  buyer_id     bigint NOT NULL REFERENCES users (id),
  seller_id    bigint NOT NULL REFERENCES users (id),
  status       text NOT NULL DEFAULT 'awaiting_shipment'
               CHECK (status IN ('awaiting_shipment', 'shipped', 'completed', 'refunded')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trades_no_self_trade CHECK (buyer_id <> seller_id)
);
CREATE INDEX trades_release_recent_idx ON trades (release_id, created_at DESC);
CREATE INDEX trades_buyer_id_idx ON trades (buyer_id);
CREATE INDEX trades_seller_id_idx ON trades (seller_id);
