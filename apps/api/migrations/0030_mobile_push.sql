-- Push is independent of WhatsApp contacts, consent and outbox.
CREATE TABLE mobile_push_registration (
  installation_hash TEXT PRIMARY KEY CHECK(length(installation_hash)=64),
  provider TEXT NOT NULL CHECK(provider IN ('apns','fcm')),
  token_hash TEXT NOT NULL UNIQUE,
  token_cipher TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('es','en')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX mobile_push_registration_age ON mobile_push_registration(updated_at);
CREATE TABLE mobile_push_outbox (
  id TEXT PRIMARY KEY CHECK(length(id)=32),
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  installation_hash TEXT NOT NULL,
  entry_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('called','expired','cancelled')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','discarded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  last_error TEXT,
  UNIQUE(entry_id,entry_version,kind)
);
CREATE INDEX mobile_push_age ON mobile_push_outbox(created_at);
CREATE INDEX mobile_push_due ON mobile_push_outbox(status,next_attempt_at);
CREATE INDEX mobile_push_installation ON mobile_push_outbox(installation_hash);
-- Atomic with the queue transition, including expiry/cancel/yield paths. No WA consent filter.
-- No row for web entries or installations that have not opted in.
CREATE TRIGGER mobile_push_transition AFTER UPDATE OF status ON queue_entry
WHEN NEW.status <> OLD.status AND NEW.status IN ('called','expired','cancelled')
BEGIN
  INSERT OR IGNORE INTO mobile_push_outbox
    (id,entry_id,installation_hash,entry_version,kind,next_attempt_at,expires_at,created_at)
  SELECT lower(hex(randomblob(16))),NEW.id,m.installation_hash,NEW.version,NEW.status,
    unixepoch()*1000,
    CASE WHEN NEW.status='called' THEN COALESCE(NEW.arrival_deadline_at,unixepoch()*1000) ELSE unixepoch()*1000+600000 END,
    unixepoch()*1000
  FROM mobile_entry_installation m JOIN mobile_push_registration r ON r.installation_hash=m.installation_hash
  WHERE m.entry_id=NEW.id AND r.enabled=1;
END;
