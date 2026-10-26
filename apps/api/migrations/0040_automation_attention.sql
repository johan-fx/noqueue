-- Pending intervention is a snapshot, not replayable toast history. No backfill.
CREATE TABLE queue_automation_attention (
  cycle_id TEXT PRIMARY KEY REFERENCES queue_automation_cycle(id) ON DELETE CASCADE,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT CHECK(resolution IN ('assigned','empty','service_ended')),
  resolved_entry_id TEXT REFERENCES queue_entry(id) ON DELETE SET NULL
);
CREATE INDEX automation_attention_pending ON queue_automation_attention(queue_id,created_at) WHERE resolved_at IS NULL;
