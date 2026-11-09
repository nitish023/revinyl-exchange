-- Removing a copy from your crate (Part 3). A copy that has ever been listed or traded is
-- named by old orders and trades, so deleting its row would break that history. Instead a
-- removed copy gets removed_at and drops out of the crate, the forms and the market.
-- Only a copy sitting in the crate can be removed.
ALTER TABLE copies
  ADD COLUMN removed_at timestamptz,
  ADD CONSTRAINT copies_removed_in_crate CHECK (removed_at IS NULL OR status = 'in_crate');
CREATE INDEX copies_owner_active_idx ON copies (owner_id) WHERE removed_at IS NULL;
