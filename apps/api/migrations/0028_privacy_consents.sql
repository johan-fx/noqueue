-- Optional analytics decisions are deliberately independent of queue/WhatsApp consent.
CREATE TABLE privacy_consent_receipt (
  decision_id TEXT PRIMARY KEY,
  consent_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  revision INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('es','en')),
  analytics INTEGER NOT NULL CHECK(analytics IN (0,1)),
  received_at INTEGER NOT NULL
);
CREATE INDEX privacy_consent_received ON privacy_consent_receipt(received_at);
CREATE TABLE privacy_consent_limit (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX privacy_consent_limit_expiry ON privacy_consent_limit(expires_at);
