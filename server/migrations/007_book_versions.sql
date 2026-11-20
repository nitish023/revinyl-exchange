-- Multi-instance safety (Part 7). Each pressing's order book lives in the memory of every
-- server process. A process that orders on a pressing first takes a Postgres advisory lock
-- for it (pg_advisory_xact_lock(release_id)), so only one process at a time changes that
-- pressing's orders, and bumps its version here in the same transaction. A process whose
-- in-memory book is at an older version than this row knows another process changed the
-- orders, and reloads the book from the database before matching.
CREATE TABLE book_versions (
  release_id bigint PRIMARY KEY REFERENCES releases (id),
  version    bigint NOT NULL CHECK (version > 0)
);
