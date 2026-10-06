-- Existing calls retain NULL deadlines and their manual arrival policy.
ALTER TABLE queue_entry ADD COLUMN arrival_deadline_at INTEGER;
CREATE INDEX queue_arrival_deadline ON queue_entry(queue_id,arrival_deadline_at) WHERE status='called';
CREATE TABLE customer_command (
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(entry_id,request_key)
);
CREATE TABLE customer_event_detail (
  event_id TEXT PRIMARY KEY REFERENCES queue_event(id) ON DELETE CASCADE,
  metadata TEXT NOT NULL
);
