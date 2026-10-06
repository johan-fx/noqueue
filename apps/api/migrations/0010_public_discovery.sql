-- Existing venues remain usable through direct links but require confirmed location for discovery.
ALTER TABLE venue ADD COLUMN address_formatted TEXT;
ALTER TABLE venue ADD COLUMN address_json TEXT;
ALTER TABLE venue ADD COLUMN latitude REAL CHECK(latitude BETWEEN -90 AND 90);
ALTER TABLE venue ADD COLUMN longitude REAL CHECK(longitude BETWEEN -180 AND 180);
ALTER TABLE venue ADD COLUMN location_source TEXT;
ALTER TABLE venue ADD COLUMN location_provider TEXT;
ALTER TABLE venue ADD COLUMN location_provider_id TEXT;
ALTER TABLE venue ADD COLUMN location_attribution TEXT;
ALTER TABLE venue ADD COLUMN location_confirmed_at INTEGER;
ALTER TABLE venue ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX venue_coordinates ON venue(latitude,longitude) WHERE location_confirmed_at IS NOT NULL;
CREATE VIRTUAL TABLE service_search USING fts5(queue_id UNINDEXED, service_name, venue_name, address, tokenize='unicode61 remove_diacritics 2');
INSERT INTO service_search SELECT q.id,q.name,v.name,COALESCE(v.address_formatted,'') FROM queue q JOIN venue v ON v.id=q.venue_id;
CREATE TRIGGER service_search_insert AFTER INSERT ON queue BEGIN
  INSERT INTO service_search SELECT new.id,new.name,v.name,COALESCE(v.address_formatted,'') FROM venue v WHERE v.id=new.venue_id;
END;
CREATE TRIGGER service_search_update AFTER UPDATE OF name,venue_id ON queue BEGIN
  DELETE FROM service_search WHERE queue_id=old.id;
  INSERT INTO service_search SELECT new.id,new.name,v.name,COALESCE(v.address_formatted,'') FROM venue v WHERE v.id=new.venue_id;
END;
CREATE TRIGGER service_search_delete AFTER DELETE ON queue BEGIN
  DELETE FROM service_search WHERE queue_id=old.id;
END;
CREATE TRIGGER venue_search_update AFTER UPDATE OF name,address_formatted ON venue BEGIN
  DELETE FROM service_search WHERE queue_id IN (SELECT id FROM queue WHERE venue_id=new.id);
  INSERT INTO service_search SELECT q.id,q.name,new.name,COALESCE(new.address_formatted,'') FROM queue q WHERE q.venue_id=new.id;
END;
