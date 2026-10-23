-- Preserve surviving call-attempt history when privacy retention deletes an
-- entry and cascades to its cycle. Equivalent to ON DELETE SET NULL on the
-- optional link, without rewriting migration 0036 or rebuilding its table.
CREATE TRIGGER automation_history_before_delete
BEFORE DELETE ON queue_automation_cycle
BEGIN
  UPDATE queue_call_replacement
  SET automation_cycle_id = NULL
  WHERE automation_cycle_id = OLD.id;
END;
