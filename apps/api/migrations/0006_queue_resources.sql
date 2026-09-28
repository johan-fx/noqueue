-- Additive rollout: legacy data remains intact; no inferred occupancy reset.
CREATE TABLE queue_allocation (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  seats INTEGER NOT NULL,
  reserved_at INTEGER NOT NULL,
  arrived_at INTEGER,
  released_at INTEGER,
  outcome TEXT
);
CREATE UNIQUE INDEX one_active_resource ON queue_allocation(queue_id,resource_id) WHERE released_at IS NULL;
CREATE TABLE queue_projection (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  eta_minutes INTEGER NOT NULL,
  predicted_at INTEGER,
  quality TEXT NOT NULL,
  resource_id TEXT,
  callable INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE queue_estimate_intent (
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'policy_pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY(entry_id,revision)
);
CREATE TABLE queue_wait_evidence (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  predicted_at INTEGER,
  actual_at INTEGER NOT NULL,
  error_minutes REAL,
  legacy_eta_minutes INTEGER NOT NULL,
  forecast_created_at INTEGER,
  mode TEXT NOT NULL
);
CREATE TABLE queue_override_audit (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE queue_adjustment_audit (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  adjustments TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE queue_forecast_anchor (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  predicted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  legacy_eta_minutes INTEGER NOT NULL
);
