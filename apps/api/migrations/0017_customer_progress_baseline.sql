-- Customer progress is independent of staff forecast/legacy ETA evidence.
ALTER TABLE queue_entry ADD COLUMN progress_initial_eta_minutes INTEGER
  CHECK (progress_initial_eta_minutes IS NULL OR progress_initial_eta_minutes > 0);

UPDATE queue_entry
SET progress_initial_eta_minutes = (
  SELECT CAST((predicted_at - created_at + 59999) / 60000 AS INTEGER)
  FROM queue_forecast_anchor
  WHERE entry_id = queue_entry.id AND predicted_at > created_at
)
WHERE progress_initial_eta_minutes IS NULL;

UPDATE queue_entry
SET progress_initial_eta_minutes =
  CAST((arrival_deadline_at - called_at + 59999) / 60000 AS INTEGER)
WHERE progress_initial_eta_minutes IS NULL AND status = 'called'
  AND arrival_deadline_at > called_at;
