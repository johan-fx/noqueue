-- Immutable admission snapshots distinguish continuous turns from unresolved legacy rows.
ALTER TABLE queue_entry ADD COLUMN service_window_id TEXT;
ALTER TABLE queue_entry ADD COLUMN service_ends_at INTEGER;
CREATE INDEX queue_service_deadline ON queue_entry(queue_id,service_ends_at)
  WHERE status='waiting' AND service_ends_at IS NOT NULL;
CREATE INDEX queue_service_ended_event ON queue_event(entry_id)
  WHERE kind='service_ended';
