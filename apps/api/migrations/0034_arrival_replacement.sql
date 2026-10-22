-- No backfill: only calls made by the new code can authorize a replacement.
CREATE TABLE queue_call_replacement (
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  call_cycle INTEGER NOT NULL,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
  origin TEXT NOT NULL CHECK(origin IN ('staff','yield','arrival_expiry','legacy')),
  service_type TEXT NOT NULL,
  service_ends_at INTEGER,
  result TEXT NOT NULL CHECK(result IN ('pending','replaced','yielded','arrived','cancelled','no_show','returned_to_waiting','no_candidate','missing_context','context_changed','service_ended','disabled','legacy')),
  successor_entry_id TEXT REFERENCES queue_entry(id) ON DELETE SET NULL,
  successor_call_cycle INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(entry_id,call_cycle)
);
CREATE UNIQUE INDEX replacement_successor ON queue_call_replacement(successor_entry_id,successor_call_cycle)
  WHERE successor_entry_id IS NOT NULL;
CREATE INDEX replacement_queue ON queue_call_replacement(queue_id);
