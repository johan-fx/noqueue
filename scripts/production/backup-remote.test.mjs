import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { readConfig } from './config.mjs'
import { inventorySQL, columnsSQL, parseColumns, snapshotSQL, assembleSnapshot } from './backup.mjs'
import { restoreBatchPlan, rehearseSnapshot, compareSnapshots } from './backup-remote.mjs'
const config = await readConfig()
const source = { accountId: config.account_id, databaseId: config.env.production.d1_databases[0].database_id }
const targetId = '11111111-2222-4333-8444-555555555555'
function fixture() {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON')
    const dir = new URL('../../apps/api/migrations/', import.meta.url)
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'))
    db.exec('CREATE TABLE large_fixture(id INTEGER PRIMARY KEY, value TEXT)')
    for (let i=0;i<20;i++) db.prepare('INSERT INTO large_fixture VALUES (?,?)').run(i, 'x'.repeat(6000))
    const schema = JSON.parse(db.prepare(inventorySQL).get().schema_json)
    const columns = parseColumns(db.prepare(columnsSQL(schema)).get())
    return assembleSnapshot(schema, db.prepare(snapshotSQL(schema, columns)).get(), source)
  } finally { db.close() }
}
const snapshot = fixture()
function fakeProvider({ failRestore = false, failCapture = false, failDelete = false, nonAtomicProbe = false, returnedId = targetId } = {}) {
  let db, name, deleted = false
  const calls = []
  const response = (result, status=200, errors=[]) => ({ok:status<400,status,json:async()=>({success:status<400,result,errors})})
  const request = async (url, options) => {
    const method=options.method, body=options.body?JSON.parse(options.body):undefined
    calls.push({url,method,body})
    assert.equal(options.redirect,'error')
    if (url.endsWith('/d1/database') && method==='POST') {
      name=body.name;assert.equal(body.jurisdiction,'eu')
      db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
      return response({uuid:returnedId,name})
    }
    assert.ok(url.includes(`/d1/database/${targetId}`),'Only the newly created target may be contacted')
    if (deleted) return response(null,404)
    if (method==='GET') return response({uuid:targetId,name})
    if (method==='DELETE') {
      if(failDelete)return response(null,500)
      db.close();db=undefined;deleted=true;return response({})
    }
    try {
      if(body.batch){
        if(failRestore && body.batch.length>3) return response(null,500)
        if(nonAtomicProbe && body.batch.length===3) {for(const item of body.batch) db.exec(item.sql)}
        db.exec('BEGIN')
        try { for(const item of body.batch) db.exec(item.sql); db.exec('COMMIT') }
        catch(e){db.exec('ROLLBACK');throw e}
        return response(body.batch.map(()=>({success:true,results:[]})))
      }
      if(failCapture && db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='large_fixture'").get().n && body.sql===inventorySQL) return response(null,500)
      if(/^(SELECT|PRAGMA)/.test(body.sql)) return response([{success:true,results:db.prepare(body.sql).all()}])
      db.exec(body.sql);return response([{success:true,results:[]}])
    } catch(error) {return response(null,400,[{message:error.message}])}
  }
  return {request,calls,get deleted(){return deleted},close(){db?.close()}}
}
test('restore plan keeps large backup atomic with per-statement and aggregate bounds', () => {
  const plan=restoreBatchPlan(snapshot)
  assert.ok(plan.summary.sqlBytes>95000)
  assert.ok(plan.summary.maxStatementBytes<95000)
  assert.ok(plan.summary.requestBytes<1024*1024)
  assert.equal(plan.body.batch[0].sql,'PRAGMA defer_foreign_keys=ON;')
  assert.ok(plan.body.batch.some(item=>/CREATE TRIGGER[\s\S]*;[\s\S]*END/i.test(item.sql)), 'Trigger bodies remain intact')
  const huge=structuredClone(snapshot)
  huge.tables.find(t=>t.name==='large_fixture').rows[0]="INSERT INTO large_fixture VALUES (1,'"+'x'.repeat(96000)+"');"
  assert.throws(()=>restoreBatchPlan(huge),/statement exceeds 95 kB/)
  huge.tables[0].rows=['x'.repeat(1024*1024)]
  assert.throws(()=>restoreBatchPlan(huge),/Snapshot exceeds/)
})
test('full rehearsal proves rollback, compares all data, checks FTS and confirms deletion', async () => {
  const fake=fakeProvider(),report={}
  try {
    await rehearseSnapshot({snapshot,config,token:'synthetic',report,saveReport:async()=>{},request:fake.request})
    assert.equal(report.rehearsal,'passed');assert.equal(report.atomicRollbackProbe,'passed')
    assert.deepEqual(report.comparison,{tables:true,schema:true,sequences:true})
    assert.equal(report.remoteForeignKeys,'ok');assert.equal(report.remoteQuickCheck,'ok')
    assert.equal(report.ftsInsertUpdateDelete,'passed')
    assert.equal(fake.deleted,true);assert.equal(report.rehearsalDatabase.deletionConfirmed,'HTTP 404')
    assert.equal(fake.calls.filter(c=>c.body?.batch?.length>3).length,1)
    assert.ok(fake.calls.every(c=>!c.url.includes(source.databaseId)))
  } finally {fake.close()}
})
for(const failure of ['failRestore','failCapture']) test(`${failure} cleans up without retrying or claiming success`,async()=>{
  const fake=fakeProvider({[failure]:true}),report={}
  try {
    await assert.rejects(rehearseSnapshot({snapshot,config,token:'synthetic',report,saveReport:async()=>{},request:fake.request}))
    assert.equal(report.rehearsal,'failed');assert.equal(fake.deleted,true)
    assert.equal(fake.calls.filter(c=>c.body?.batch?.length>3).length,1)
  } finally {fake.close()}
})
test('cleanup failure is visible, never reported as a completed rehearsal',async()=>{
 const fake=fakeProvider({failDelete:true}),report={}
 try {
  await assert.rejects(rehearseSnapshot({snapshot,config,token:'synthetic',report,saveReport:async()=>{},request:fake.request}))
  assert.equal(report.rehearsal,'cleanup-failed');assert.equal(report.rehearsalDatabase.deleted,false)
 } finally {fake.close()}
})
test('protected production/staging/sandbox IDs are never queried or deleted even if returned by create',async()=>{
 const ids=[source.databaseId,...Object.values(config.env).flatMap(e=>(e.d1_databases??[]).map(d=>d.database_id))]
 for(const returnedId of ids){
  const fake=fakeProvider({returnedId})
  try {
   await assert.rejects(rehearseSnapshot({snapshot,config,token:'synthetic',report:{},saveReport:async()=>{},request:fake.request}),/protected/)
   assert.equal(fake.calls.length,1)
  } finally {fake.close()}
 }
})
test('comparison detects missing rows/schema/sequences instead of prefix-only matches',()=>{
 for(const field of ['tables','schema','sequences']){
  const copy=structuredClone(snapshot)
  if(field==='sequences')copy[field].push({name:'extra',seq:'1'});else copy[field].pop()
  assert.equal(compareSnapshots(snapshot,copy)[field],false)
 }
})


test('non-atomic provider stops before customer restore and still deletes the disposable DB',async()=>{
 const fake=fakeProvider({nonAtomicProbe:true}),report={}
 try {
  await assert.rejects(rehearseSnapshot({snapshot,config,token:'synthetic',report,saveReport:async()=>{},request:fake.request}),/must be empty/)
  assert.equal(report.rehearsal,'failed');assert.equal(fake.deleted,true)
  assert.equal(fake.calls.filter(c=>c.body?.batch?.length>3).length,0)
 } finally {fake.close()}
})
test('ambiguous creation is not retried and keeps only the requested name for recovery',async()=>{
 let calls=0;const report={}
 await assert.rejects(rehearseSnapshot({snapshot,config,token:'synthetic',report,saveReport:async()=>{},request:async()=>{calls++;throw Error('timeout')}}),/outcome unknown/)
 assert.equal(calls,1)
 assert.equal(report.rehearsalDatabase.creation,'requested')
 assert.match(report.rehearsalDatabase.name,/^noqueue-backup-check-/)
 assert.equal(report.rehearsalDatabase.id,undefined)
 assert.notEqual(report.rehearsal,'passed')
})
