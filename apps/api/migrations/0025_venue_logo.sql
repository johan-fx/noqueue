-- Logos are establishment-scoped, not Better Auth organization branding.
ALTER TABLE venue ADD COLUMN logo_key TEXT;
ALTER TABLE venue ADD COLUMN logo_name TEXT;
ALTER TABLE venue ADD COLUMN logo_type TEXT;
ALTER TABLE venue ADD COLUMN logo_size INTEGER;
ALTER TABLE venue ADD COLUMN logo_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX venue_logo_key ON venue(logo_key) WHERE logo_key IS NOT NULL;

-- Register before writing R2. Even interrupted/failed uploads remain collectible.
-- No FK: deletion of a venue must not erase the durable cleanup record.
CREATE TABLE venue_logo_object (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  delete_after INTEGER NOT NULL,
  upload_finished INTEGER NOT NULL DEFAULT 0,
  cleanup_attempted_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX venue_logo_cleanup ON venue_logo_object(delete_after);

-- Committed requests only; replay never reapplies an old logo over a newer edit.
CREATE TABLE venue_logo_request (
  actor_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id, venue_id, request_key)
);
