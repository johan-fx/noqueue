-- Independent analytical data: intentionally no FK cascade from operational entries.
CREATE TABLE metrics_context (queue_id TEXT PRIMARY KEY, at INTEGER NOT NULL, origin TEXT NOT NULL);
CREATE TABLE metrics_identity (
 entry_id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, venue_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 service_type TEXT NOT NULL, timezone TEXT NOT NULL, created_at INTEGER NOT NULL,
 first_called_at INTEGER, historical INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE metrics_event (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, revision INTEGER NOT NULL,
 queue_id TEXT NOT NULL, venue_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 service_type TEXT NOT NULL, timezone TEXT NOT NULL, created_at INTEGER NOT NULL,
 at INTEGER NOT NULL, status TEXT NOT NULL, party_size INTEGER NOT NULL, first_called_at INTEGER,
 previous_status TEXT, previous_party_size INTEGER,
 origin TEXT NOT NULL, historical INTEGER NOT NULL DEFAULT 0,
 UNIQUE(entry_id,revision)
);
CREATE INDEX metrics_event_retention ON metrics_event(at,seq);
CREATE TABLE metrics_entry (
 entry_id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, revision INTEGER NOT NULL, dimension TEXT NOT NULL,
 created_at INTEGER NOT NULL, status TEXT NOT NULL, party_size INTEGER NOT NULL,
 first_called_at INTEGER, updated_at INTEGER NOT NULL, historical INTEGER NOT NULL
);
CREATE INDEX metrics_entry_retention ON metrics_entry(updated_at,entry_id);
CREATE TABLE metrics_queue (
 dimension TEXT PRIMARY KEY, queue_id TEXT NOT NULL, venue_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 service_type TEXT NOT NULL, timezone TEXT NOT NULL, people INTEGER NOT NULL CHECK(people>=0),
 integrated_at INTEGER NOT NULL, coverage_since INTEGER NOT NULL
);
CREATE TABLE metrics_daily (
 dimension TEXT NOT NULL, queue_id TEXT NOT NULL, venue_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 service_type TEXT NOT NULL, timezone TEXT NOT NULL, date TEXT NOT NULL,
 generated INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0,
 no_show INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0,
 wait_sum_ms INTEGER NOT NULL DEFAULT 0, wait_samples INTEGER NOT NULL DEFAULT 0, historical INTEGER NOT NULL DEFAULT 0,
 people_ms REAL NOT NULL DEFAULT 0, observed_ms INTEGER NOT NULL DEFAULT 0,
 first_wait_at INTEGER, last_wait_at INTEGER,
 PRIMARY KEY(dimension,date)
);
CREATE INDEX metrics_daily_scope ON metrics_daily(venue_id,date,service_type);
CREATE INDEX metrics_daily_date ON metrics_daily(date,venue_id);
CREATE TABLE metrics_hourly (
 dimension TEXT NOT NULL, queue_id TEXT NOT NULL, venue_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 service_type TEXT NOT NULL, timezone TEXT NOT NULL, date TEXT NOT NULL, hour INTEGER NOT NULL, bucket_at INTEGER NOT NULL, bucket_end INTEGER NOT NULL,
 generated INTEGER NOT NULL DEFAULT 0, wait_sum_ms INTEGER NOT NULL DEFAULT 0, wait_samples INTEGER NOT NULL DEFAULT 0,
 people_ms REAL NOT NULL DEFAULT 0, observed_ms INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(dimension,bucket_at)
);
CREATE INDEX metrics_hourly_scope ON metrics_hourly(venue_id,date,service_type);
CREATE INDEX metrics_hourly_date ON metrics_hourly(date,venue_id);
CREATE TABLE metrics_control (
 id INTEGER PRIMARY KEY CHECK(id=1), cursor INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, last_complete_at INTEGER,
 target_seq INTEGER, target_at INTEGER, integrate_after TEXT NOT NULL DEFAULT '', formula_version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO metrics_control(id) VALUES(1);
CREATE TABLE metrics_fence (ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE metrics_backfill (
 queue_id TEXT PRIMARY KEY, after_created INTEGER NOT NULL DEFAULT 0, after_id TEXT NOT NULL DEFAULT '',
 started_at INTEGER NOT NULL, completed_at INTEGER
);

CREATE TRIGGER metrics_capture_insert AFTER INSERT ON queue_entry
WHEN NEW.queue_id != 'confirmation-experiment' AND EXISTS(SELECT 1 FROM metrics_context WHERE queue_id=NEW.queue_id) 
BEGIN
 INSERT OR IGNORE INTO metrics_identity(entry_id,queue_id,venue_id,organization_id,service_type,timezone,created_at,first_called_at,historical)
 SELECT NEW.id,q.id,v.id,v.organization_id,COALESCE(json_extract(q.config,'$.type'),'unknown'),v.timezone,NEW.created_at,
 COALESCE((SELECT actual_at FROM queue_wait_evidence WHERE entry_id=NEW.id),NEW.called_at),0
 FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=NEW.queue_id;
 UPDATE metrics_identity SET first_called_at=COALESCE(first_called_at,CASE WHEN historical=0 THEN NEW.called_at ELSE (SELECT actual_at FROM queue_wait_evidence WHERE entry_id=NEW.id) END) WHERE entry_id=NEW.id;
 INSERT OR IGNORE INTO metrics_event(entry_id,revision,queue_id,venue_id,organization_id,service_type,timezone,created_at,at,status,party_size,first_called_at,origin,historical,previous_status,previous_party_size)
 SELECT i.entry_id,NEW.version,i.queue_id,i.venue_id,i.organization_id,i.service_type,i.timezone,i.created_at,c.at,NEW.status,NEW.party_size,i.first_called_at,c.origin,i.historical,NULL,NULL
 FROM metrics_identity i JOIN metrics_context c ON c.queue_id=i.queue_id WHERE i.entry_id=NEW.id;
END;

CREATE TRIGGER metrics_capture_update AFTER UPDATE OF status,party_size,called_at ON queue_entry
WHEN NEW.queue_id != 'confirmation-experiment' AND EXISTS(SELECT 1 FROM metrics_context WHERE queue_id=NEW.queue_id) AND (OLD.status != NEW.status OR OLD.party_size != NEW.party_size OR OLD.called_at IS NOT NEW.called_at)
BEGIN
 INSERT OR IGNORE INTO metrics_identity(entry_id,queue_id,venue_id,organization_id,service_type,timezone,created_at,first_called_at,historical)
 SELECT NEW.id,q.id,v.id,v.organization_id,'unknown',v.timezone,NEW.created_at,
 (SELECT actual_at FROM queue_wait_evidence WHERE entry_id=NEW.id),1
 FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=NEW.queue_id;
 UPDATE metrics_identity SET first_called_at=COALESCE(first_called_at,CASE WHEN historical=0 THEN NEW.called_at ELSE (SELECT actual_at FROM queue_wait_evidence WHERE entry_id=NEW.id) END) WHERE entry_id=NEW.id;
 INSERT OR IGNORE INTO metrics_event(entry_id,revision,queue_id,venue_id,organization_id,service_type,timezone,created_at,at,status,party_size,first_called_at,origin,historical,previous_status,previous_party_size)
 SELECT i.entry_id,NEW.version,i.queue_id,i.venue_id,i.organization_id,i.service_type,i.timezone,i.created_at,c.at,NEW.status,NEW.party_size,i.first_called_at,c.origin,i.historical,OLD.status,OLD.party_size
 FROM metrics_identity i JOIN metrics_context c ON c.queue_id=i.queue_id WHERE i.entry_id=NEW.id;
END;
ALTER TABLE metrics_backfill ADD COLUMN phase INTEGER NOT NULL DEFAULT 0;
CREATE INDEX metrics_backfill_entries ON queue_entry(queue_id,created_at,id);
CREATE INDEX metrics_backfill_active ON queue_entry(queue_id,status,created_at,id);
CREATE INDEX metrics_entry_cohort ON metrics_entry(dimension,created_at);
CREATE TABLE metrics_dirty (dimension TEXT NOT NULL,date TEXT NOT NULL,PRIMARY KEY(dimension,date));
ALTER TABLE metrics_control ADD COLUMN reconciled_on TEXT;
CREATE TABLE metrics_capture_gap (started_at INTEGER PRIMARY KEY,ended_at INTEGER);

ALTER TABLE metrics_backfill ADD COLUMN repair_since INTEGER;

CREATE INDEX metrics_entry_queue_cohort ON metrics_entry(queue_id,created_at,entry_id);
