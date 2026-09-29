-- Additive, opt-in rollout. Existing open queues retain their current mode.
CREATE TABLE queue_intelligence_rollout (
  venue_id TEXT PRIMARY KEY REFERENCES venue(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1))
);
CREATE TABLE queue_opening (
  queue_id TEXT PRIMARY KEY REFERENCES queue(id) ON DELETE CASCADE,
  topology TEXT NOT NULL,
  complete INTEGER NOT NULL CHECK (complete IN (0,1)),
  opened_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE TABLE queue_external_occupancy (
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  seats INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (queue_id, resource_id)
);
CREATE TABLE queue_inventory_audit (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Protect both directions even if a future caller misses application validation.
CREATE TRIGGER prevent_allocating_external_occupancy BEFORE INSERT ON queue_allocation
WHEN NEW.released_at IS NULL AND EXISTS (
  SELECT 1 FROM queue_external_occupancy WHERE queue_id=NEW.queue_id AND resource_id=NEW.resource_id
) BEGIN SELECT RAISE(ABORT, 'resource_already_occupied'); END;
CREATE TRIGGER prevent_external_queue_collision BEFORE INSERT ON queue_external_occupancy
WHEN EXISTS (
  SELECT 1 FROM queue_allocation WHERE queue_id=NEW.queue_id AND resource_id=NEW.resource_id AND released_at IS NULL
) BEGIN SELECT RAISE(ABORT, 'resource_already_allocated'); END;

CREATE INDEX queue_inventory_audit_queue_action ON queue_inventory_audit(queue_id,action);
