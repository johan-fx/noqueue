-- Additive WhatsApp lifecycle storage. Legacy rows retain payload_version=1 and
-- continue through the existing provider-template selectors.
ALTER TABLE notification_outbox ADD COLUMN payload_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_outbox ADD COLUMN payload_snapshot TEXT;
ALTER TABLE notification_outbox ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_outbox ADD COLUMN call_cycle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_outbox ADD COLUMN accepted_at INTEGER;
ALTER TABLE notification_outbox ADD COLUMN opened_at INTEGER;
ALTER TABLE queue_entry ADD COLUMN call_cycle INTEGER NOT NULL DEFAULT 0;

CREATE TABLE queue_notification_state (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  last_accepted_predicted_at INTEGER,
  last_correction_accepted_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX outbox_notice_revision ON notification_outbox(entry_id,kind,revision,call_cycle);
