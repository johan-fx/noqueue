-- Priorities are explicit, consumable and independent of the original FIFO slot.
ALTER TABLE queue ADD COLUMN priority_counter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_entry ADD COLUMN priority_rank INTEGER;
CREATE INDEX queue_priority ON queue_entry(queue_id,status,priority_rank,sequence);

-- Durable delivery cursor for staff feedback, not an in-memory row-diff feed.
-- Names remain encrypted on entries and are resolved only by authorized readers.
CREATE TABLE queue_staff_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  call_cycle INTEGER NOT NULL,
  cycle_id TEXT NOT NULL REFERENCES queue_automation_cycle(id) ON DELETE CASCADE,
  successor_entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  successor_call_cycle INTEGER NOT NULL,
  cause TEXT NOT NULL CHECK(cause IN ('arrival_expiry','customer_cancel','customer_yield','staff_pass')),
  created_at INTEGER NOT NULL,
  UNIQUE(entry_id,call_cycle,cause)
);
CREATE INDEX staff_event_cursor ON queue_staff_event(queue_id,id);
