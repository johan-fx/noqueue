PRAGMA foreign_keys = ON;
CREATE TABLE organization (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE venue (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organization(id), name TEXT NOT NULL);
CREATE TABLE queue (id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venue(id), capacity INTEGER NOT NULL CHECK(capacity > 0), average_minutes INTEGER NOT NULL CHECK(average_minutes > 0), open INTEGER NOT NULL DEFAULT 1);
CREATE TABLE queue_entry (
  id TEXT PRIMARY KEY, queue_id TEXT NOT NULL REFERENCES queue(id), idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE,
  party_size INTEGER NOT NULL CHECK(party_size BETWEEN 1 AND 20), locale TEXT NOT NULL CHECK(locale IN ('es','en')),
  status TEXT NOT NULL DEFAULT 'waiting', created_at INTEGER NOT NULL, sequence INTEGER NOT NULL,
  UNIQUE(queue_id,idempotency_key), UNIQUE(queue_id,sequence)
);
CREATE TABLE queue_entry_contact (entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE, phone_cipher TEXT NOT NULL, phone_hash TEXT NOT NULL);
CREATE INDEX contact_phone ON queue_entry_contact(phone_hash);
CREATE TABLE consent (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL UNIQUE REFERENCES queue_entry(id) ON DELETE CASCADE, organization_id TEXT NOT NULL REFERENCES organization(id), purpose TEXT NOT NULL, version TEXT NOT NULL, granted_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE TABLE queue_event (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL UNIQUE REFERENCES queue_entry(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', provider_id TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  dead_lettered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON notification_outbox(status,next_attempt_at);
CREATE TABLE webhook_event (id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  provider_id TEXT, status TEXT, phone_hash TEXT, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
  processed_at INTEGER);
CREATE INDEX webhook_pending ON webhook_event(processed_at,received_at);
CREATE TABLE pilot_rate (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
INSERT INTO organization VALUES ('demo-org','No Queue Demo');
INSERT INTO venue VALUES ('demo-venue','demo-org','Demo Restaurant');
INSERT INTO queue VALUES ('demo-queue','demo-venue',20,5,1);
