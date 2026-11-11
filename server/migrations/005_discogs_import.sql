-- Discogs collection import (Part 6). An imported copy remembers which item of the owner's
-- Discogs collection it came from (Discogs calls it the instance id: the same release can
-- be in a collection twice), so importing again doesn't add the same record twice.
-- Removing an imported copy frees its instance id, so it can be imported again later.
ALTER TABLE copies
  ADD COLUMN discogs_instance_id bigint CHECK (discogs_instance_id > 0),
  ADD CONSTRAINT copies_instance_only_when_imported
    CHECK (discogs_instance_id IS NULL OR source = 'discogs_import');
CREATE UNIQUE INDEX copies_one_active_import_per_instance
  ON copies (owner_id, discogs_instance_id)
  WHERE discogs_instance_id IS NOT NULL AND removed_at IS NULL;
