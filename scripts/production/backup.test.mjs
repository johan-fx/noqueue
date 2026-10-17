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

test('backup CLI refuses unconfirmed production reads and an archive without isolated rehearsal',async()=>{
 const {spawnSync}=await import('node:child_process')
 for(const args of [[],['--archive','synthetic.json']]) {
  const run=spawnSync(process.execPath,['scripts/production/backup-production.mjs',...args],{encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:''}})
  assert.notEqual(run.status,0);assert.match(run.stderr,/failed at preflight/)
 }
})
