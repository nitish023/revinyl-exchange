-- Ads that expire, and "stay on top" repricing rules (Part 15).
--
--   expires_at            when an open ad closes on its own (status 'expired'); NULL runs
--                         until it fills or is cancelled
--   reprice_step_cents    the rule: beat the best competing ad by this much...
--   reprice_limit_cents   ...but never go below this (a FOR SALE ad's floor) or above it
--                         (a WANTED ad's ceiling)
--   replaces_order_id     a repriced ad is a new order that replaced this one, so an ad's
--                         history can be followed
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN reprice_step_cents integer CHECK (reprice_step_cents BETWEEN 1 AND 10000),
  ADD COLUMN reprice_limit_cents integer CHECK (reprice_limit_cents BETWEEN 100 AND 1000000),
  ADD COLUMN replaces_order_id bigint REFERENCES orders (id),
  ADD CONSTRAINT orders_reprice_both CHECK ((reprice_step_cents IS NULL) = (reprice_limit_cents IS NULL)),
  ADD CONSTRAINT orders_reprice_limit_side CHECK (
    reprice_limit_cents IS NULL
    OR (side = 'ask' AND reprice_limit_cents <= price_cents)
    OR (side = 'bid' AND reprice_limit_cents >= price_cents)
  ),
  ADD CONSTRAINT orders_expires_after_created CHECK (expires_at IS NULL OR expires_at > created_at),
  -- A targeted order ("Buy this copy", "Sell to them") never rests, so it has neither.
  ADD CONSTRAINT orders_targeted_plain CHECK (
    target_order_id IS NULL OR (expires_at IS NULL AND reprice_step_cents IS NULL)
  );

-- The sweep looks for open ads whose time is up.
CREATE INDEX orders_open_expiring_idx ON orders (expires_at)
  WHERE status = 'open' AND expires_at IS NOT NULL;
