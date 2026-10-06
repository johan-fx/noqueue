-- Only application-validated, source-bound snapshots may enter the public catalogue.
-- Existing confirmed venues are prepared by the bounded scheduled backfill, never by search.
CREATE TABLE service_directory_config (
  queue_id TEXT PRIMARY KEY REFERENCES queue(id) ON DELETE CASCADE,
  source_config TEXT NOT NULL,
  normalized_config TEXT CHECK(normalized_config IS NULL OR json_valid(normalized_config))
);
