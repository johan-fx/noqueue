-- Admission is independent of inventory confirmation and never deletes occupancy or turns.
CREATE TABLE queue_admission (
  queue_id TEXT PRIMARY KEY REFERENCES queue(id) ON DELETE CASCADE,
  window_id TEXT,
  override_state TEXT CHECK(override_state IN ('active','paused')),
  activated_at INTEGER,
  reminder_ack TEXT,
  legacy_paused_at INTEGER,
  legacy_config TEXT,
  legacy_timezone TEXT
);
-- Only the exact legacy active value is trusted; other existing automatic states pause this window.
-- New services have no row and therefore retain automatic admission.
INSERT INTO queue_admission(queue_id,legacy_paused_at,legacy_config,legacy_timezone)
SELECT q.id,CAST(strftime('%s','now') AS INTEGER)*1000,q.config,v.timezone FROM queue q JOIN venue v ON v.id=q.venue_id
WHERE q.open IS NOT 1 AND json_valid(q.config) AND json_extract(q.config,'$.type') IN ('reception','pool');
