-- Customer presentation is separate from real resource scheduling and historical forecast anchors.
ALTER TABLE queue_projection ADD COLUMN customer_minimum_at INTEGER;
ALTER TABLE queue_projection ADD COLUMN customer_configured_work_ms INTEGER;
ALTER TABLE queue_projection ADD COLUMN customer_initial_eta_minutes INTEGER;
ALTER TABLE queue_projection ADD COLUMN customer_operational_at INTEGER;
ALTER TABLE queue_notification_state ADD COLUMN last_accepted_customer_minimum_at INTEGER;
