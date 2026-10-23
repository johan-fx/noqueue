-- Additive: historical calls never authorize a new automatic cycle.
CREATE TABLE queue_automation_cycle (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  initial_entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  initial_call_cycle INTEGER NOT NULL,
  current_entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  current_call_cycle INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  capacity INTEGER,
  reception_service TEXT,
  space_id TEXT,
  seats INTEGER,
  service_window_id TEXT,
  service_ends_at INTEGER,
  state TEXT NOT NULL CHECK(state IN ('active','stopped')),
  reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX automation_queue ON queue_automation_cycle(queue_id,state,service_ends_at);
CREATE UNIQUE INDEX automation_current ON queue_automation_cycle(current_entry_id,current_call_cycle) WHERE state='active';
ALTER TABLE queue_call_replacement ADD COLUMN automation_cycle_id TEXT REFERENCES queue_automation_cycle(id);
-- Keep the legacy origin CHECK and its historical meaning for old readers.
-- cause is the precise trigger for new attempts (including customer_cancel).
ALTER TABLE queue_call_replacement ADD COLUMN cause TEXT;
CREATE INDEX replacement_cycle ON queue_call_replacement(automation_cycle_id);
ALTER TABLE queue_entry ADD COLUMN manual_only INTEGER NOT NULL DEFAULT 0 CHECK(manual_only IN (0,1));
