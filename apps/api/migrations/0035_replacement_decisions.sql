-- Operational decisions, not table reservations. No historical backfill.
CREATE TABLE queue_replacement_decision (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  call_cycle INTEGER NOT NULL,
  original_party_size INTEGER NOT NULL,
  space_id TEXT,
  seats INTEGER,
  service_ends_at INTEGER,
  reason TEXT NOT NULL CHECK(reason IN ('no_candidate','missing_context','context_changed')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','dismissed','ended')),
  version INTEGER NOT NULL DEFAULT 0,
  resolved_by TEXT,
  successor_entry_id TEXT REFERENCES queue_entry(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(entry_id,call_cycle)
);
CREATE INDEX replacement_decision_pending ON queue_replacement_decision(queue_id,status,created_at,id);
