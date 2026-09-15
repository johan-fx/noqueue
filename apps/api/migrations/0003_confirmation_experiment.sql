-- Additive experiment metadata; ordinary joins retain their original behavior.
ALTER TABLE notification_outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'queue_joined';
ALTER TABLE webhook_event ADD COLUMN confirmation_payload TEXT;
ALTER TABLE webhook_event ADD COLUMN context_id TEXT;
ALTER TABLE webhook_event ADD COLUMN confirmation_entry_id TEXT;
CREATE TABLE queue_confirmation (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  payload TEXT NOT NULL UNIQUE,
  contact_authorized_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  revoked_at INTEGER
);
