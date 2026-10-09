-- Historical configuration dates are unknown; do not backfill them.
ALTER TABLE venue ADD COLUMN configuration_updated_at INTEGER;
