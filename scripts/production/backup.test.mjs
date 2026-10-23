import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { inventorySQL, columnsSQL, parseColumns, snapshotSQL, assembleSnapshot, restoreStatements, encryptSnapshot, decryptSnapshot } from './backup.mjs'
const migrations = new URL('../../apps/api/migrations/',import.meta.url)
function source() {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;')
 for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL(file,migrations),'utf8'))
 db.exec(`CREATE TABLE backup_edge(id INTEGER PRIMARY KEY AUTOINCREMENT, text_value TEXT, integer_value INTEGER, blob_value BLOB, real_value REAL);
 INSERT INTO backup_edge VALUES (1,CAST(X'610062270A' AS TEXT),9223372036854775807,X'0001FF',1.2345678901234567);
 INSERT INTO backup_edge(id) VALUES (100); DELETE FROM backup_edge WHERE id=100;`)
 return db
}
function preAutomationMigration() {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;')
 const files=readdirSync(migrations).filter(f=>f.endsWith('.sql')&&f<'0036_automation_cycles.sql').sort()
 for(const file of files)db.exec(readFileSync(new URL(file,migrations),'utf8'))
 db.exec(`INSERT INTO queue_entry
   (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,status,created_at,sequence,call_cycle)
   VALUES ('legacy-entry','demo-queue','legacy-key','request','recovery','OLD1',2,'es','expired',100,1,1),
          ('legacy-successor','demo-queue','successor-key','request-2','recovery-2','OLD2',2,'es','waiting',101,2,0);
   INSERT INTO queue_call_replacement
   (entry_id,call_cycle,queue_id,eligible,origin,service_type,result,created_at,updated_at)
   VALUES ('legacy-entry',1,'demo-queue',1,'arrival_expiry','restaurant','no_candidate',200,201);
   INSERT INTO queue_replacement_decision
   (id,queue_id,entry_id,call_cycle,original_party_size,reason,status,created_at,updated_at)
   VALUES ('legacy-decision','demo-queue','legacy-entry',1,2,'no_candidate','pending',202,203);`)
 return db
}
function snapshot(db) {
 const schema=JSON.parse(db.prepare(inventorySQL).get().schema_json)
 const columns=parseColumns(db.prepare(columnsSQL(schema)).get())
 const sql=snapshotSQL(schema,columns)
 const captured=assembleSnapshot(schema,db.prepare(sql).get(),{databaseId:'synthetic'})
 return {schema,columns,sql,captured}
}
test('single read snapshot restores all migrations/data and derived FTS without rerunning triggers',()=>{
 const db=source(), restored=new DatabaseSync(':memory:')
 try {
  const {captured,sql}=snapshot(db)
  assert.ok(Buffer.byteLength(sql)<90000, 'All migrations must fit with headroom below the unchanged 95 kB guard')
  assert.match(sql,/^SELECT /);assert.ok(!/\b(DROP|DELETE|UPDATE|INSERT)\s+(TABLE|FROM|INTO|SET)\b/i.test(sql.replace(/'([^']|'')*'/g,"''")))
  restored.exec('PRAGMA foreign_keys=ON; BEGIN;'+restoreStatements(captured).join('\n')+'\nCOMMIT;')
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[])
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
  assert.deepEqual(snapshot(restored).captured.tables,captured.tables)
  assert.deepEqual(snapshot(restored).captured.sequences,captured.sequences)
  assert.equal(restored.prepare("SELECT count(*) n FROM service_search WHERE service_search MATCH 'Demo'").get().n,2)
  restored.exec("UPDATE venue SET name='Restaurado' WHERE id='demo-venue'")
  assert.equal(restored.prepare("SELECT count(*) n FROM service_search WHERE service_search MATCH 'Restaurado'").get().n,2)
  restored.exec("UPDATE queue SET name='Servicio' WHERE id='demo-queue'")
  assert.equal(restored.prepare("SELECT count(*) n FROM service_search WHERE service_search MATCH 'Servicio'").get().n,1)
  restored.exec("DELETE FROM queue WHERE id='demo-queue'")
  assert.equal(restored.prepare("SELECT count(*) n FROM service_search WHERE service_search MATCH 'Servicio'").get().n,0)
  assert.equal(restored.prepare("SELECT hex(text_value) h FROM backup_edge").get().h,'610062270A')
  assert.equal(restored.prepare("SELECT CAST(integer_value AS TEXT) n FROM backup_edge").get().n,'9223372036854775807')
  assert.equal(restored.prepare("SELECT hex(blob_value) h FROM backup_edge").get().h,'0001FF')
  assert.equal(restored.prepare("SELECT real_value n FROM backup_edge").get().n,1.2345678901234567)
  restored.exec('INSERT INTO backup_edge DEFAULT VALUES');assert.equal(restored.prepare('SELECT MAX(id) n FROM backup_edge').get().n,101)
 } finally {db.close();restored.close()}
})
test('encrypted archive rejects tampering/wrong key, snapshot rejects schema drift and unknown virtual tables',()=>{
 const db=source()
 try {
  const {schema,columns,captured}=snapshot(db),key=randomBytes(32),encrypted=encryptSnapshot(captured,key)
  assert.deepEqual(decryptSnapshot(encrypted,key),captured)
  assert.ok(!encrypted.toString().includes('demo-venue'))
  assert.throws(()=>decryptSnapshot(encrypted,randomBytes(32)),/authentication/)
  const changed=JSON.parse(encrypted);const tag=Buffer.from(changed.tag,'base64');tag[0]^=1;changed.tag=tag.toString('base64');assert.throws(()=>decryptSnapshot(JSON.stringify(changed),key),/authentication/)
  assert.throws(()=>assembleSnapshot(schema,{schema_json:'[]'},{}),/Schema changed/)
  assert.throws(()=>snapshotSQL([...schema,{type:'table',name:'unknown',sql:'CREATE VIRTUAL TABLE unknown USING fts5(text)'}],columns),/known derived/)
  assert.throws(()=>snapshotSQL(schema,columns.map(c=>({...c,hidden:1}))),/hidden/)
 } finally {db.close()}
})

test('backup capture fails closed for oversized output and restoration omits FTS shadow tables',()=>{
 const db=source()
 try {
  const {schema,columns,captured}=snapshot(db)
  const row=db.prepare(snapshotSQL(schema,columns)).get()
  const groups=JSON.parse(row.tables_json);groups[0][0].rows.push('x'.repeat(1024*1024));row.tables_json=JSON.stringify(groups)
  assert.throws(()=>assembleSnapshot(schema,row,{}),/1 MiB/)
  const statements=restoreStatements(captured)
  assert.ok(!statements.some(s=>/^CREATE TABLE.*service_search_(data|idx|content|docsize|config)/i.test(s)))
  assert.ok(statements.findIndex(s=>s.startsWith('CREATE UNIQUE INDEX'))<statements.findIndex(s=>s.startsWith('INSERT INTO')))
  assert.ok(statements.findIndex(s=>s.startsWith('CREATE TRIGGER'))>statements.findIndex(s=>s.startsWith('INSERT INTO service_search')))
 } finally {db.close()}
})

test('0036 upgrades populated 0035 replacement history additively without backfilling cycles',()=>{
 const db=preAutomationMigration()
 try {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue_call_replacement').get().n,1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue_replacement_decision').get().n,1)
  db.exec(readFileSync(new URL('0036_automation_cycles.sql',migrations),'utf8'))
  assert.deepEqual({...db.prepare(`SELECT entry_id,call_cycle,origin,result,automation_cycle_id,cause
    FROM queue_call_replacement`).get()}, {
    entry_id:'legacy-entry',call_cycle:1,origin:'arrival_expiry',result:'no_candidate',automation_cycle_id:null,cause:null,
  })
  assert.deepEqual({...db.prepare(`SELECT id,entry_id,call_cycle,reason,status FROM queue_replacement_decision`).get()}, {
    id:'legacy-decision',entry_id:'legacy-entry',call_cycle:1,reason:'no_candidate',status:'pending',
  })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue_automation_cycle').get().n,0)
  assert.deepEqual(db.prepare(`SELECT id,manual_only FROM queue_entry ORDER BY id`).all().map(row=>({...row})),[
    {id:'legacy-entry',manual_only:0},{id:'legacy-successor',manual_only:0},
  ])
  const replacementIndexes=db.prepare("PRAGMA index_list('queue_call_replacement')").all().map(row=>row.name)
  const decisionIndexes=db.prepare("PRAGMA index_list('queue_replacement_decision')").all().map(row=>row.name)
  assert.ok(replacementIndexes.includes('replacement_successor'))
  assert.ok(replacementIndexes.includes('replacement_queue'))
  assert.ok(replacementIndexes.includes('replacement_cycle'))
  assert.ok(decisionIndexes.includes('replacement_decision_pending'))
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
 } finally {db.close()}
})

test('0037 preserves populated 0036 automation cycles and replacement links without replaying historical staff feedback',()=>{
 const db=preAutomationMigration()
 try {
  db.exec(readFileSync(new URL('0036_automation_cycles.sql',migrations),'utf8'))
  db.exec(`INSERT INTO queue_entry
   (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,status,created_at,sequence,call_cycle)
   VALUES ('active-origin','demo-queue','active-origin-key','active-request','active-recovery','ACT1',4,'es','expired',300,3,1),
          ('active-successor','demo-queue','active-successor-key','active-successor-request','active-successor-recovery','ACT2',3,'es','called',301,4,1),
          ('stopped-origin','demo-queue','stopped-origin-key','stopped-request','stopped-recovery','STOP1',2,'es','cancelled',302,5,1),
          ('stopped-successor','demo-queue','stopped-successor-key','stopped-successor-request','stopped-successor-recovery','STOP2',2,'es','waiting',303,6,0);
   INSERT INTO queue_automation_cycle
   (id,queue_id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,service_type,capacity,reception_service,space_id,seats,service_window_id,service_ends_at,state,reason,version,created_at,updated_at)
   VALUES ('active-cycle','demo-queue','active-origin',1,'active-successor',1,'restaurant',4,NULL,'terrace',4,'window-active',900000,'active',NULL,2,300,350),
          ('stopped-cycle','demo-queue','stopped-origin',1,'stopped-origin',1,'reception',NULL,'check_in',NULL,NULL,'window-stopped',800000,'stopped','staff_pass',3,302,360);
   INSERT INTO queue_call_replacement
   (entry_id,call_cycle,queue_id,eligible,origin,service_type,service_ends_at,result,successor_entry_id,successor_call_cycle,created_at,updated_at,automation_cycle_id,cause)
   VALUES ('active-origin',1,'demo-queue',1,'arrival_expiry','restaurant',900000,'replaced','active-successor',1,350,351,'active-cycle','arrival_expiry'),
          ('stopped-origin',1,'demo-queue',1,'staff','reception',800000,'returned_to_waiting',NULL,NULL,355,360,'stopped-cycle','staff_pass');`)
  const before = {
   cycles: db.prepare(`SELECT id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,service_type,capacity,reception_service,space_id,seats,service_window_id,service_ends_at,state,reason,version,created_at,updated_at FROM queue_automation_cycle ORDER BY id`).all().map(row=>({...row})),
   replacements: db.prepare(`SELECT entry_id,call_cycle,origin,result,successor_entry_id,successor_call_cycle,automation_cycle_id,cause FROM queue_call_replacement WHERE entry_id IN ('active-origin','stopped-origin') ORDER BY entry_id`).all().map(row=>({...row})),
  }
  assert.equal(before.cycles.length,2)
  db.exec(readFileSync(new URL('0037_staff_queue_interactions.sql',migrations),'utf8'))
  const afterCycles = db.prepare(`SELECT id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,service_type,capacity,reception_service,space_id,seats,service_window_id,service_ends_at,state,reason,version,created_at,updated_at FROM queue_automation_cycle ORDER BY id`).all().map(row=>({...row}))
  const afterReplacements = db.prepare(`SELECT entry_id,call_cycle,origin,result,successor_entry_id,successor_call_cycle,automation_cycle_id,cause FROM queue_call_replacement WHERE entry_id IN ('active-origin','stopped-origin') ORDER BY entry_id`).all().map(row=>({...row}))
  assert.deepEqual(afterCycles,before.cycles)
  assert.deepEqual(afterReplacements,before.replacements)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue_staff_event').get().n,0,'0037 must not backfill replayable staff toast history')
  assert.equal(db.prepare("SELECT priority_counter FROM queue WHERE id='demo-queue'").get().priority_counter,0)
  assert.deepEqual(db.prepare(`SELECT id,priority_rank FROM queue_entry WHERE id IN ('active-origin','active-successor','stopped-origin','stopped-successor') ORDER BY id`).all().map(row=>({...row})),[
   {id:'active-origin',priority_rank:null},{id:'active-successor',priority_rank:null},
   {id:'stopped-origin',priority_rank:null},{id:'stopped-successor',priority_rank:null},
  ])
  assert.deepEqual(db.prepare(`SELECT id,manual_only FROM queue_entry WHERE id IN ('active-origin','active-successor','stopped-origin','stopped-successor') ORDER BY id`).all().map(row=>({...row})),[
   {id:'active-origin',manual_only:0},{id:'active-successor',manual_only:0},
   {id:'stopped-origin',manual_only:0},{id:'stopped-successor',manual_only:0},
  ])
  const cycleIndexes=db.prepare("PRAGMA index_list('queue_automation_cycle')").all().map(row=>row.name)
  const replacementIndexes=db.prepare("PRAGMA index_list('queue_call_replacement')").all().map(row=>row.name)
  const eventIndexes=db.prepare("PRAGMA index_list('queue_staff_event')").all().map(row=>row.name)
  const priorityIndexes=db.prepare("PRAGMA index_list('queue_entry')").all().map(row=>row.name)
  assert.ok(cycleIndexes.includes('automation_current'))
  assert.ok(replacementIndexes.includes('replacement_successor'))
  assert.ok(replacementIndexes.includes('replacement_queue'))
  assert.ok(replacementIndexes.includes('replacement_cycle'))
  assert.ok(eventIndexes.includes('staff_event_cursor'))
  assert.ok(priorityIndexes.includes('queue_priority'))
  const {sql}=snapshot(db)
  assert.ok(Buffer.byteLength(sql)<90000,`0037 backup snapshot query must retain 5 kB headroom under the unchanged 95 kB D1 bound; got ${Buffer.byteLength(sql)}`)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')
 } finally {db.close()}
})

test('backup CLI refuses unconfirmed production reads and an archive without isolated rehearsal',async()=>{
 const {spawnSync}=await import('node:child_process')
 for(const args of [[],['--archive','synthetic.json']]) {
  const run=spawnSync(process.execPath,['scripts/production/backup-production.mjs',...args],{encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:''}})
  assert.notEqual(run.status,0);assert.match(run.stderr,/failed at preflight/)
 }
})

test('compact literals preserve every SQLite storage class and hostile text without JS numeric conversion',()=>{
 const db=source(), restored=new DatabaseSync(':memory:')
 try {
  // No affinity: exercise storage classes independently of declared column types.
  db.exec(`CREATE TABLE backup_values(value);
   INSERT INTO backup_values VALUES (NULL),(''),(X''),(X'0001FF'),
    (9223372036854775807),(-9223372036854775808),(1.2345678901234567),
    (CAST(X'610062270A' AS TEXT)),('');`)
  db.prepare('INSERT INTO backup_values VALUES (?)').run("💾 café'); DROP TABLE backup_values; --\n\0end")
  const {captured}=snapshot(db)
  const rows=captured.tables.find(t=>t.name==='backup_values').rows
  assert.ok(rows.some(stmt=>stmt.includes("X'610062270A'||''")), 'Embedded-NUL text must be rebuilt as TEXT without quote() truncation')
  restored.exec('PRAGMA foreign_keys=ON; BEGIN;'+restoreStatements(captured).join('\n')+'\nCOMMIT;')
  const inspect=`SELECT _rowid_,typeof(value) AS kind,hex(value) AS bytes,quote(value) AS literal FROM backup_values ORDER BY _rowid_`
  assert.deepEqual(restored.prepare(inspect).all(),db.prepare(inspect).all())
 } finally {db.close();restored.close()}
})

test('snapshot query still fails closed above 95000 bytes instead of splitting reads',()=>{
 const db=source()
 try {
  const {schema,columns,sql}=snapshot(db)
  // This identifier occurs four times (INSERT columns, typeof, hex, quote).
  // Test immediately on either side of the actual guard, not just a huge query.
  const padding=Math.floor((95000-Buffer.byteLength(sql))/4)
  const padded=n=>columns.map(c=>c.tbl==='backup_edge'&&c.name==='real_value'?{...c,name:c.name+'_'.repeat(n)}:c)
  const bytes=Buffer.byteLength(snapshotSQL(schema,padded(padding)))
  assert.equal(bytes,Buffer.byteLength(sql)+4*padding)
  assert.ok(bytes<=95000&&bytes>94996)
  assert.throws(()=>snapshotSQL(schema,padded(padding+1)),/Snapshot SQL exceeds bounded D1 query size; do not paginate/)
 } finally {db.close()}
})
