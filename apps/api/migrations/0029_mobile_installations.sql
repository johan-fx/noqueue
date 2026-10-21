-- Additive: no changes to web contacts/consents or recovery capabilities.
-- Only a domain-separated hash of the installation secret is persisted.
CREATE TABLE mobile_entry_installation (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  installation_hash TEXT NOT NULL CHECK(length(installation_hash) = 64),
  created_at INTEGER NOT NULL
);
CREATE INDEX mobile_entry_installation_lookup ON mobile_entry_installation(installation_hash);
