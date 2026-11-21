-- Every trade that settled says when (Part 12 counts a seller's last 90 days by it), and
-- every trade that was shipped says when. Migration 006 couldn't require this because the
-- demo seed wrote finished trades without the dates; the seed now writes them, so fill in
-- any that are missing from older demo data and let the database insist from now on.
UPDATE trades SET settled_at = updated_at
 WHERE status IN ('completed', 'refunded') AND settled_at IS NULL;
UPDATE trades SET shipped_at = updated_at
 WHERE status IN ('shipped', 'completed') AND shipped_at IS NULL;

ALTER TABLE trades
  ADD CONSTRAINT trades_settled_at CHECK ((status IN ('completed', 'refunded')) = (settled_at IS NOT NULL)),
  ADD CONSTRAINT trades_shipped_before_done CHECK (status NOT IN ('shipped', 'completed') OR shipped_at IS NOT NULL);
