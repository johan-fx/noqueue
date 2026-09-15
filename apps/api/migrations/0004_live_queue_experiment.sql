-- Preserve prior migration history and existing delivery receipts; an entry can now
-- have a confirmation and multiple independently idempotent position updates.
CREATE TABLE notification_outbox_v4 (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', provider_id TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  dead_lettered INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'queue_joined', position INTEGER
);
INSERT INTO notification_outbox_v4 SELECT *,NULL FROM notification_outbox;
DROP TABLE notification_outbox;
ALTER TABLE notification_outbox_v4 RENAME TO notification_outbox;
CREATE INDEX outbox_pending ON notification_outbox(status,next_attempt_at);
CREATE INDEX outbox_entry ON notification_outbox(entry_id,kind);
CREATE TABLE experiment_action (idempotency_key TEXT PRIMARY KEY, action TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE whatsapp_contact_state (phone_hash TEXT PRIMARY KEY, last_inbound_at INTEGER NOT NULL, stopped_at INTEGER);
INSERT INTO queue VALUES ('confirmation-experiment','demo-venue',4,5,1);
