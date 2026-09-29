-- Nullable additions preserve existing turns and rolling client compatibility.
ALTER TABLE queue_entry ADD COLUMN display_name_cipher TEXT;
ALTER TABLE queue_entry ADD COLUMN reception_service TEXT CHECK (reception_service IN ('check_in', 'check_out', 'other'));
ALTER TABLE queue_entry ADD COLUMN preferred_space_id TEXT;
CREATE INDEX queue_entry_preferred_space ON queue_entry(queue_id, preferred_space_id, status);
