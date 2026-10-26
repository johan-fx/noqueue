-- Preserve historical turns; new silent admissions set this atomically at creation.
-- This is a transport policy, not a consent revocation or a manual-only turn.
ALTER TABLE queue_entry ADD COLUMN whatsapp_suppressed INTEGER NOT NULL DEFAULT 0
  CHECK (whatsapp_suppressed IN (0, 1));
