-- Preserve old routing IDs and outcomes. Only future domain transactions create
-- lifecycle intents; this migration never replays history.
DROP TRIGGER mobile_push_transition;
CREATE TABLE mobile_push_outbox_v2 (
  id TEXT PRIMARY KEY CHECK(length(id)=32),
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  installation_hash TEXT NOT NULL,
  entry_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('called','expired','cancelled','approaching','delayed','improved','service_ended')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','discarded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  last_error TEXT,
  payload_version INTEGER NOT NULL DEFAULT 1 CHECK(payload_version IN (1,2)),
  payload_snapshot TEXT,
  event_key TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0,
  call_cycle INTEGER NOT NULL DEFAULT 0
);
INSERT INTO mobile_push_outbox_v2
  (id,entry_id,installation_hash,entry_version,kind,status,attempts,next_attempt_at,expires_at,created_at,accepted_at,last_error,event_key)
SELECT id,entry_id,installation_hash,entry_version,kind,status,attempts,next_attempt_at,expires_at,created_at,accepted_at,last_error,'legacy:'||id FROM mobile_push_outbox;
DROP TABLE mobile_push_outbox;
ALTER TABLE mobile_push_outbox_v2 RENAME TO mobile_push_outbox;
CREATE INDEX mobile_push_age ON mobile_push_outbox(created_at);
CREATE INDEX mobile_push_due ON mobile_push_outbox(status,next_attempt_at);
CREATE INDEX mobile_push_installation ON mobile_push_outbox(installation_hash);
CREATE INDEX mobile_push_entry ON mobile_push_outbox(entry_id,kind,call_cycle,revision);

-- A screen/synchronization reference is NOT a provider acceptance or a read.
CREATE TABLE mobile_push_state (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  reference_predicted_at REAL,
  reference_operational_delta_ms REAL,
  reference_minimum_at REAL,
  reference_source TEXT NOT NULL CHECK(reference_source IN ('screen','sync','fcm')),
  reference_at INTEGER NOT NULL,
  reference_cycle INTEGER NOT NULL,
  reference_revision INTEGER NOT NULL,
  reference_notice_id TEXT NOT NULL DEFAULT '',
  last_correction_accepted_at INTEGER,
  last_accepted_safety_revision INTEGER,
  eligible_after INTEGER NOT NULL
);

-- Read-only policy adapters. WhatsApp keeps its own history and dispatch path.
CREATE VIEW queue_notice_reference AS
SELECT n.entry_id,n.last_accepted_predicted_at,n.last_correction_accepted_at,n.updated_at,
  n.last_accepted_at,n.last_accepted_call_cycle,n.last_accepted_revision,n.last_accepted_notification_id,
  n.last_accepted_operational_delta_ms,n.last_accepted_customer_minimum_at,n.last_accepted_safety_revision
FROM queue_notification_state n
WHERE NOT EXISTS(SELECT 1 FROM mobile_entry_installation m WHERE m.entry_id=n.entry_id)
UNION ALL
SELECT entry_id,reference_predicted_at,last_correction_accepted_at,reference_at,
  reference_at,reference_cycle,reference_revision,reference_notice_id,
  reference_operational_delta_ms,reference_minimum_at,last_accepted_safety_revision
FROM mobile_push_state;

CREATE VIEW queue_notice_history AS
SELECT entry_id,kind,status,payload_snapshot,revision,call_cycle FROM notification_outbox
WHERE NOT EXISTS(SELECT 1 FROM mobile_entry_installation m WHERE m.entry_id=notification_outbox.entry_id)
UNION ALL
SELECT entry_id,CASE kind WHEN 'called' THEN 'ready' ELSE kind END,
  CASE status WHEN 'discarded' THEN 'cancelled' ELSE status END,payload_snapshot,revision,call_cycle
FROM mobile_push_outbox;
