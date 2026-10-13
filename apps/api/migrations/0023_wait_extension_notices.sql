-- One durable event per increase, independent of projection revisions and delivery.
-- Existing forecasts are the baseline; no historical events/messages are replayed.
CREATE TABLE queue_wait_extension (
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  call_cycle INTEGER NOT NULL,
  extension_sequence INTEGER NOT NULL CHECK(extension_sequence > 0),
  previous_at REAL NOT NULL,
  predicted_at REAL NOT NULL CHECK(predicted_at > previous_at),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(entry_id, call_cycle, extension_sequence)
);
CREATE INDEX queue_wait_extension_sequence ON queue_wait_extension(entry_id, extension_sequence);
