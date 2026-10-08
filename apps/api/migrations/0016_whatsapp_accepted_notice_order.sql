-- Keep ETA baselines monotonic when provider callbacks arrive out of order.
ALTER TABLE queue_notification_state ADD COLUMN last_accepted_at INTEGER;
ALTER TABLE queue_notification_state ADD COLUMN last_accepted_call_cycle INTEGER NOT NULL DEFAULT -1;
ALTER TABLE queue_notification_state ADD COLUMN last_accepted_revision INTEGER NOT NULL DEFAULT -1;
ALTER TABLE queue_notification_state ADD COLUMN last_accepted_notification_id TEXT NOT NULL DEFAULT '';
