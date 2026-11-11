-- The trade after the match (Part 5): the seller ships, the buyer checks the record, and
-- the money goes to the seller (completed) or back to the buyer (refunded).
--   shipped_at  when the seller pressed "Ship it" (NULL if they cancelled before shipping)
--   settled_at  when the money moved for good: completed or refunded
-- Trades that settled before these columns existed (the demo data) take updated_at for both.
-- The demo seed writes finished trades directly, so the only rule enforced here is the one
-- every row can keep: a trade still waiting to ship has no shipping date.
ALTER TABLE trades
  ADD COLUMN shipped_at timestamptz,
  ADD COLUMN settled_at timestamptz,
  ADD CONSTRAINT trades_shipped_at CHECK (status <> 'awaiting_shipment' OR shipped_at IS NULL);

UPDATE trades SET shipped_at = updated_at WHERE status IN ('shipped', 'completed');
UPDATE trades SET settled_at = updated_at WHERE status IN ('completed', 'refunded');
