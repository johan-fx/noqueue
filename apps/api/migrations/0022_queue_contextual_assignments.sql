-- Additive transition: historical allocations are intentionally untouched.
ALTER TABLE queue_assignment_observation ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE queue_assignment_observation ADD COLUMN provenance TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE queue_assignment_observation ADD COLUMN model_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE queue_cadence_state ADD COLUMN model_revision INTEGER NOT NULL DEFAULT 1;
CREATE INDEX assignment_context_recent ON queue_assignment_observation(queue_id, model_revision, source, space_id, seats, assigned_at DESC) WHERE ratio IS NOT NULL;
CREATE INDEX assignment_zone_recent ON queue_assignment_observation(queue_id, model_revision, source, space_id, assigned_at DESC) WHERE ratio IS NOT NULL;
