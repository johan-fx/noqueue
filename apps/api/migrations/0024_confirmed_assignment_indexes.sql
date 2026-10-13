-- Keep contextual learning bounded even when confirmed samples are sparse among
-- years of inferred history. No table/data changes or history reclassification.
CREATE INDEX assignment_confirmed_context_recent
ON queue_assignment_observation(queue_id, model_revision, source, space_id, seats, assigned_at DESC)
WHERE ratio IS NOT NULL AND provenance='confirmed';
CREATE INDEX assignment_confirmed_zone_recent
ON queue_assignment_observation(queue_id, model_revision, source, space_id, assigned_at DESC)
WHERE ratio IS NOT NULL AND provenance='confirmed';
