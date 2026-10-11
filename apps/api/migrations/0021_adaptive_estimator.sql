-- Adaptive estimator is the application default. Mark existing rows as legacy until
-- their first silent recalculation; retain v1 for explicit technical rollback.
ALTER TABLE queue_projection ADD COLUMN estimator_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE queue_notification_state ADD COLUMN last_accepted_safety_revision INTEGER;
CREATE TABLE queue_cadence_state (
  queue_id TEXT PRIMARY KEY REFERENCES queue(id) ON DELETE CASCADE,
  estimator_version INTEGER NOT NULL DEFAULT 1,
  episode_id TEXT,
  episode_started_at INTEGER,
  service_window_id TEXT,
  last_assignment_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE queue_assignment_observation (
  entry_id TEXT NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
  call_cycle INTEGER NOT NULL,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  resource_id TEXT,
  space_id TEXT,
  seats INTEGER,
  baseline_ms REAL NOT NULL CHECK(baseline_ms>0),
  interval_ms REAL CHECK(interval_ms>=0),
  ratio REAL CHECK(ratio>=0),
  PRIMARY KEY(entry_id,call_cycle)
);
CREATE INDEX assignment_observation_recent ON queue_assignment_observation(queue_id,assigned_at DESC);
CREATE INDEX assignment_ratio_recent ON queue_assignment_observation(queue_id,assigned_at DESC) WHERE ratio IS NOT NULL;
CREATE TABLE queue_adaptive_projection (
  entry_id TEXT PRIMARY KEY REFERENCES queue_entry(id) ON DELETE CASCADE,
  predicted_at INTEGER NOT NULL,
  cadence_ms REAL NOT NULL,
  quality TEXT NOT NULL DEFAULT 'provisional',
  safety_review_at INTEGER,
  delay_reason TEXT,
  delay_since INTEGER,
  delay_baseline_at INTEGER,
  approach_episode INTEGER NOT NULL DEFAULT 0,
  approach_armed INTEGER NOT NULL DEFAULT 1,
  correction_reason TEXT,
  safety_revision INTEGER NOT NULL DEFAULT 0,
  notice_baseline_at INTEGER NOT NULL
);
CREATE INDEX adaptive_safety_due ON queue_adaptive_projection(safety_review_at) WHERE safety_review_at IS NOT NULL;

CREATE TABLE queue_demand_episode (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT
);
CREATE INDEX demand_episode_service_date ON queue_demand_episode(queue_id,started_at DESC);
