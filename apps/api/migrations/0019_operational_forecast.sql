-- Additive scalar provenance. NULL accepted baselines initialize conservatively.
ALTER TABLE queue_projection ADD COLUMN operational_forecast_delta_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_notification_state ADD COLUMN last_accepted_operational_delta_ms INTEGER;
CREATE INDEX queue_venue_lookup ON queue(venue_id);
CREATE INDEX queue_entry_status_sequence ON queue_entry(queue_id,status,sequence);
CREATE INDEX allocation_valid_history ON queue_allocation(queue_id,space_id,seats,released_at)
  WHERE outcome='served' AND arrived_at IS NOT NULL AND released_at-arrived_at BETWEEN 60000 AND 86400000;
CREATE INDEX queue_event_kind_time ON queue_event(kind,created_at DESC,entry_id);
