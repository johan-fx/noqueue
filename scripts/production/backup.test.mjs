import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { inventorySQL, columnsSQL, parseColumns, snapshotSQL, assembleSnapshot, restoreStatements, encryptSnapshot, decryptSnapshot } from './backup.mjs'
import { validateRestoreSize, verifyLocalRestore, sameRestoredRow } from './backup-local.mjs'
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
  // The original identifier occurs twice (INSERT columns and aliased SELECT).
  // Test immediately on either side of the actual guard, not just a huge query.
  const padding=Math.floor((95000-Buffer.byteLength(sql))/2)
  const padded=n=>columns.map(c=>c.tbl==='backup_edge'&&c.name==='real_value'?{...c,name:c.name+'_'.repeat(n)}:c)
  const bytes=Buffer.byteLength(snapshotSQL(schema,padded(padding)))
  assert.equal(bytes,Buffer.byteLength(sql)+2*padding)
  assert.ok(bytes<=95000&&bytes>94998)
  assert.throws(()=>snapshotSQL(schema,padded(padding+1)),/Snapshot SQL exceeds bounded D1 query size; do not paginate/)
 } finally {db.close()}
})

test('0038 permits privacy deletion after handoff and preserves surviving attempt history across backup restore',()=>{
 for(const deleted of ['legacy-entry','legacy-successor']) {
  const db=preAutomationMigration(),restored=new DatabaseSync(':memory:')
  try {
   db.exec(readFileSync(new URL('0036_automation_cycles.sql',migrations),'utf8'))
   db.exec(readFileSync(new URL('0037_staff_queue_interactions.sql',migrations),'utf8'))
   db.exec(`UPDATE queue_entry SET status='called',call_cycle=1 WHERE id='legacy-successor';
    INSERT INTO queue_automation_cycle(id,queue_id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,service_type,state,created_at,updated_at)
    VALUES ('privacy-cycle','demo-queue','legacy-entry',1,'legacy-successor',1,'pool','active',100,200);
    UPDATE queue_call_replacement SET automation_cycle_id='privacy-cycle' WHERE entry_id='legacy-entry';
    INSERT INTO queue_call_replacement(entry_id,call_cycle,queue_id,eligible,origin,service_type,result,created_at,updated_at,automation_cycle_id)
    VALUES ('legacy-successor',1,'demo-queue',1,'arrival_expiry','pool','pending',200,200,'privacy-cycle');`)
   assert.throws(()=>db.prepare('DELETE FROM queue_entry WHERE id=?').run(deleted),/FOREIGN KEY/)
   db.exec(readFileSync(new URL('0038_automation_history_cleanup.sql',migrations),'utf8'))
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue_call_replacement WHERE automation_cycle_id IS NOT NULL').get().n,2)
   const {captured,sql}=snapshot(db)
   assert.ok(Buffer.byteLength(sql)<90000,'Keep the existing 95 kB hard limit and 5 kB headroom')
   restored.exec('PRAGMA foreign_keys=ON; BEGIN;'+restoreStatements(captured).join('\n')+'\nCOMMIT;')
   for(const target of [db,restored]) {
    target.prepare('DELETE FROM queue_entry WHERE id=?').run(deleted)
    const survivor=deleted==='legacy-entry'?'legacy-successor':'legacy-entry'
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM queue_automation_cycle').get().n,0)
    assert.deepEqual({...target.prepare('SELECT entry_id,automation_cycle_id FROM queue_call_replacement').get()}, {entry_id:survivor,automation_cycle_id:null})
    assert.equal(target.prepare('SELECT status FROM queue_entry WHERE id=?').get(survivor).status, survivor==='legacy-successor'?'called':'expired')
    assert.deepEqual(target.prepare('PRAGMA foreign_key_check').all(),[])
   }
  } finally {db.close();restored.close()}
 }
})

test('0040 durable attention survives backup restore and cascades with its expired entry',()=>{
 const db=source(), restored=new DatabaseSync(':memory:')
 try {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue_automation_attention').get().n,0)
  db.exec(`INSERT INTO queue_entry
    (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,status,created_at,sequence,call_cycle)
    VALUES ('attention-root','demo-queue','attention-key','r','h','ATT1',2,'es','expired',100,1,1);
    INSERT INTO queue_automation_cycle(id,queue_id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,service_type,capacity,space_id,seats,state,reason,created_at,updated_at)
    VALUES ('attention-cycle','demo-queue','attention-root',1,'attention-root',1,'restaurant',2,'inside',2,'stopped','no_candidate',100,160);
    INSERT INTO queue_automation_attention(cycle_id,queue_id,entry_id,created_at) VALUES ('attention-cycle','demo-queue','attention-root',160);`)
  const {captured}=snapshot(db)
  restored.exec('PRAGMA foreign_keys=ON; BEGIN;'+restoreStatements(captured).join('\n')+'\nCOMMIT;')
  assert.deepEqual(restored.prepare('SELECT * FROM queue_automation_attention').all(),db.prepare('SELECT * FROM queue_automation_attention').all())
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[])
  restored.exec("DELETE FROM queue_entry WHERE id='attention-root'")
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM queue_automation_attention').get().n,0)
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[])
 } finally {db.close();restored.close()}
})


test('local-only verification restores a larger encrypted archive without relaxing remote limits', () => {
 const db=source()
 try {
  db.prepare('INSERT INTO backup_edge(text_value) VALUES (?)').run('x'.repeat(120000))
  const {captured}=snapshot(db),key=randomBytes(32)
  const saved=encryptSnapshot(captured,key), restored=decryptSnapshot(saved,key)
  const sql=restoreStatements(restored).join('\n')
  assert.ok(Buffer.byteLength(sql)>95000)
  assert.throws(()=>validateRestoreSize(sql),/95 kB/)
  assert.throws(()=>validateRestoreSize(sql,{rehearse:true}),/95 kB/)
  assert.throws(()=>validateRestoreSize(sql,{localOnly:true,rehearse:true}),/cannot create/)
  assert.equal(validateRestoreSize(sql,{localOnly:true}).remoteSingleRequestSupported,false)
  assert.deepEqual(verifyLocalRestore(restored), {target:'local-memory',data:'identical',schema:'identical',sequences:'identical',integrity:'ok',foreignKeys:'ok',ftsInsertUpdateDelete:'passed'})
  assert.throws(()=>validateRestoreSize('x'.repeat(1024*1024+1),{localOnly:true}),/1 MiB/)
 } finally { db.close() }
})

test('restore size boundaries preserve remote single-request guard and local opt-in', () => {
 assert.equal(validateRestoreSize('x'.repeat(95000)).remoteSingleRequestSupported,true)
 assert.throws(()=>validateRestoreSize('x'.repeat(95001)),/95 kB/)
 assert.equal(validateRestoreSize('x'.repeat(95001),{localOnly:true}).remoteSingleRequestSupported,false)
})

test('saved archive can be fully verified offline with no Cloudflare credentials or network', async () => {
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const {spawnSync}=await import('node:child_process')
 const {readConfig}=await import('./config.mjs')
 const dir=mkdtempSync(join(tmpdir(),'noqueue-offline-restore-')),db=source()
 try {
  db.prepare('INSERT INTO backup_edge(text_value) VALUES (?)').run('x'.repeat(120000))
  const config=await readConfig(),{captured}=snapshot(db),key=randomBytes(32)
  captured.source={accountId:config.account_id,databaseId:config.env.production.d1_databases[0].database_id}
  const archive=join(dir,'backup.aes256gcm'),keyFile=join(dir,'key.hex')
  writeFileSync(archive,encryptSnapshot(captured,key),{mode:0o600})
  writeFileSync(keyFile,key.toString('hex'),{mode:0o600})
  const script=`globalThis.fetch=()=>{throw Error('Network forbidden in offline restore')};process.argv=[process.execPath,'backup-production.mjs','--archive',${JSON.stringify(archive)},'--key-file',${JSON.stringify(keyFile)},'--directory',${JSON.stringify(dir)},'--local-only'];await import(${JSON.stringify(new URL('./backup-production.mjs',import.meta.url).href)})`
  const result=spawnSync(process.execPath,['--input-type=module'],{input:script,encoding:'utf8',env:{PATH:process.env.PATH}})
  assert.equal(result.status,0,result.stderr)
  assert.match(result.stdout,/local integrity verification complete/)
  const reportName=readdirSync(dir).find(name=>name.endsWith('.report.json'))
  const report=JSON.parse(readFileSync(join(dir,reportName),'utf8'))
  assert.equal(report.sourceRead,false)
  assert.equal(report.localOnly,true)
  assert.equal(report.rehearsal,'not-requested')
  assert.equal(report.remoteSingleRequestSupported,false)
  assert.equal(report.localVerification.data,'identical')
  assert.equal(report.localVerification.ftsInsertUpdateDelete,'passed')
 } finally { db.close();rmSync(dir,{recursive:true,force:true}) }
})


test('cross-SQLite REAL quoting compares exact values without weakening int64/text/blob checks', () => {
 const row = value => `INSERT INTO "example"("_rowid_","value") VALUES (1,${value});`
 assert.equal(sameRestoredRow(row('0.1'),row('1.0e-1')),true)
 assert.equal(sameRestoredRow(row('1.25'),row('1.2500000000000000000e+00')),true)
 for (const [a,b] of [['1.0','1.0000000000000002'], ['9007199254740992','9007199254740993'], ['1','1.0'], ["X'00'","X'01'"], ["X'610062'||''","X'61'||''"], ['NULL','0'], ['9.0e999','1.0e999']])
  assert.equal(sameRestoredRow(row(a),row(b)),false)
 assert.equal(sameRestoredRow(row('1.0'),row('1.0').replace('(1,','(2,')),false)
 assert.equal(sameRestoredRow(row('1.0'),row('1.0').replace('example','different')),false)
 const db=source()
 try {
  db.exec('UPDATE backup_edge SET real_value=1.25 WHERE id=1')
  const {captured}=snapshot(db)
  const edge=captured.tables.find(t=>t.name==='backup_edge')
  assert.ok(edge.rows[0].includes('1.25'))
  edge.rows[0]=edge.rows[0].replace('1.25','1.2500000000000000000e+00')
  assert.equal(verifyLocalRestore(captured).data,'identical')
 } finally { db.close() }
})
