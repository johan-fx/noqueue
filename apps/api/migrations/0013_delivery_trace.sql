-- Safe, append-only delivery evidence. Retention is based on server recording time.
CREATE TABLE notification_trace (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  attempt INTEGER,
  provider_id TEXT,
  http_status INTEGER,
  provider_code INTEGER,
  occurred_at INTEGER,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX notification_trace_retention ON notification_trace(recorded_at);
CREATE INDEX notification_trace_notification ON notification_trace(notification_id,recorded_at);
CREATE TRIGGER notification_queued_trace AFTER INSERT ON notification_outbox
BEGIN
  INSERT INTO notification_trace(id,notification_id,event,recorded_at)
  VALUES (NEW.id || ':queued',NEW.id,'queued',NEW.updated_at);
END;
