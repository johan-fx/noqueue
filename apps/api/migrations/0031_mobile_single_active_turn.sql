-- Fail before enabling the invariant if older installations have duplicates.
-- Never pick/cancel a customer's turn as part of a schema migration.
CREATE TABLE mobile_single_turn_preflight (ok INTEGER NOT NULL CHECK(ok = 1));
INSERT INTO mobile_single_turn_preflight
SELECT CASE WHEN EXISTS (
  SELECT m.installation_hash FROM mobile_entry_installation m
  JOIN queue_entry e ON e.id=m.entry_id WHERE e.status IN ('waiting','called')
  GROUP BY m.installation_hash HAVING COUNT(*) > 1
) THEN 0 ELSE 1 END;
DROP TABLE mobile_single_turn_preflight;

CREATE TRIGGER mobile_single_active_insert BEFORE INSERT ON mobile_entry_installation
WHEN EXISTS (SELECT 1 FROM queue_entry WHERE id=NEW.entry_id AND status IN ('waiting','called'))
AND EXISTS (
  SELECT 1 FROM mobile_entry_installation m JOIN queue_entry e ON e.id=m.entry_id
  WHERE m.installation_hash=NEW.installation_hash AND e.id<>NEW.entry_id AND e.status IN ('waiting','called')
)
BEGIN SELECT RAISE(ABORT, 'mobile_active_turn_exists'); END;

CREATE TRIGGER mobile_single_active_binding_update BEFORE UPDATE OF entry_id,installation_hash ON mobile_entry_installation
WHEN NEW.entry_id<>OLD.entry_id OR NEW.installation_hash<>OLD.installation_hash
BEGIN SELECT RAISE(ABORT, 'mobile_installation_immutable'); END;

CREATE TRIGGER mobile_single_active_status BEFORE UPDATE OF status ON queue_entry
WHEN NEW.status IN ('waiting','called') AND EXISTS (
  SELECT 1 FROM mobile_entry_installation owner
  JOIN mobile_entry_installation other ON other.installation_hash=owner.installation_hash AND other.entry_id<>NEW.id
  JOIN queue_entry e ON e.id=other.entry_id
  WHERE owner.entry_id=NEW.id AND e.status IN ('waiting','called')
)
BEGIN SELECT RAISE(ABORT, 'mobile_active_turn_exists'); END;
