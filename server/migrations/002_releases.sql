-- The record catalog. Every pressing is a Discogs release; we cache the details we
-- show so pressing pages don't call Discogs (60 requests/minute) on every visit.
-- Rows are refreshed when older than CATALOG_MAX_AGE_HOURS. Copies, orders and
-- trades (later migrations) reference releases(id), so a pressing must be cached
-- before anyone can list or bid on it (CatalogService.ensureRelease in server/src/catalog).

CREATE TABLE releases (
  id          bigint PRIMARY KEY CHECK (id > 0), -- the Discogs release ID
  title       text NOT NULL,
  artist      text NOT NULL,
  year        integer CHECK (year IS NULL OR year BETWEEN 1880 AND 2100),
  released    text,
  country     text,
  label       text,
  catno       text,
  formats     text[] NOT NULL DEFAULT '{}',
  genres      text[] NOT NULL DEFAULT '{}',
  styles      text[] NOT NULL DEFAULT '{}',
  tracklist   jsonb NOT NULL DEFAULT '[]',
  cover_url   text,
  thumb_url   text,
  discogs_url text NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
