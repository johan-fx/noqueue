// Production is read-only. --local-only never creates a remote database.
// Optional --rehearse writes ONLY a newly created, unbound EU D1.
import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { restoreBatchPlan, rehearseSnapshot } from './backup-remote.mjs'
import { validateRestoreSize, verifyLocalRestore } from './backup-local.mjs'
import { productionD1 } from '../../apps/api/scripts/production-d1.mjs'
import { readConfig, assertProductionIdentity } from './config.mjs'
import { inventorySQL, columnsSQL, parseColumns, snapshotSQL, assembleSnapshot, restoreStatements, encryptSnapshot, decryptSnapshot, digest } from './backup.mjs'

let stage='preflight'
async function capture(db,source) {
 stage='capture inventory'
 const schema=JSON.parse((await db(inventorySQL))[0].results[0].schema_json)
 stage='capture column metadata'
 const columns=parseColumns((await db(columnsSQL(schema)))[0].results[0])
 stage='capture consistent snapshot'
 return assembleSnapshot(schema,(await db(snapshotSQL(schema,columns)))[0].results[0],source)
}
async function main() {
 const {values}=parseArgs({options:{'confirm-production-read':{type:'boolean'},rehearse:{type:'boolean'},'local-only':{type:'boolean'},directory:{type:'string'},archive:{type:'string'},'key-file':{type:'string'}}})
 assert.ok(!(values['local-only']&&values.rehearse),'--local-only cannot be combined with --rehearse')
 if(values.archive) assert.ok(values.rehearse||values['local-only'],'Existing archives require explicit local-only or isolated remote rehearsal')
 else assert.equal(values['confirm-production-read'],true,'Explicit production backup authorization required')
 const config=await readConfig();assertProductionIdentity(config,{provisioned:true})
 const accountId=config.account_id,databaseId=config.env.production.d1_databases[0].database_id,token=process.env.CLOUDFLARE_API_TOKEN
 if(!values.archive||values.rehearse) {assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,accountId,'Explicit matching account required');assert.ok(token,'Authorized token required')}
 const directory=resolve(values.directory??'reports/production-private/backups')
 await mkdir(directory,{recursive:true,mode:0o700})
 const dirInfo=await lstat(directory);assert.ok(dirInfo.isDirectory()&&(dirInfo.mode&0o077)===0,'Private nonsymlink 0700 backup folder required')
 const keyPath=resolve(values['key-file']??join(directory,'backup-key.hex'))
 let key
 if(!values.archive) try { await writeFile(keyPath,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600}) } catch(e) {if(e.code!=='EEXIST')throw e}
 const info=await lstat(keyPath);assert.ok(info.isFile()&&(info.mode&0o077)===0,'Private nonsymlink key file required')
 const hex=(await readFile(keyPath,'utf8')).trim();assert.match(hex,/^[a-f0-9]{64}$/);key=Buffer.from(hex,'hex')
 let snapshot, existingEncrypted
 if(values.archive) {
  const file=await lstat(resolve(values.archive));assert.ok(file.isFile()&&(file.mode&0o077)===0&&file.size<=2*1024*1024,'Private bounded archive required')
  existingEncrypted=await readFile(resolve(values.archive))
  snapshot=decryptSnapshot(existingEncrypted,key)
  assert.deepEqual(snapshot.source,{accountId,databaseId},'Archive identity mismatch')
 } else {
  snapshot=await capture(productionD1({accountId,databaseId,token}),{accountId,databaseId})
 }
 stage='validate restore size'
 const sql=restoreStatements(snapshot).join('\n')
 const restoreSize=values.rehearse ? {bytes:Buffer.byteLength(sql),remoteSingleRequestSupported:true,batch:restoreBatchPlan(snapshot).summary}
   : validateRestoreSize(sql,{localOnly:values['local-only']===true})
 const encrypted=existingEncrypted??encryptSnapshot(snapshot,key), restored=decryptSnapshot(encrypted,key)
 assert.deepEqual(restored,snapshot,'Encryption roundtrip failed')
 stage='local restore integrity'
 verifyLocalRestore(restored)
 const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-')
 const out=values.archive?resolve(values.archive):join(directory,`production-${stamp}.json.aes256gcm`)
 if(!values.archive) await writeFile(out,encrypted,{flag:'wx',mode:0o600})
 const archiveSnapshot=decryptSnapshot(await readFile(out),key)
 assert.deepEqual(archiveSnapshot,snapshot,'On-disk encrypted archive differs')
 const localVerification=verifyLocalRestore(archiveSnapshot)
 const report={localVerification,restoreSqlBytes:restoreSize.bytes,remoteSingleRequestSupported:restoreSize.remoteSingleRequestSupported,localOnly:values['local-only']===true,format:'noqueue-backup-report-v1',capturedAt:snapshot.capturedAt,source:snapshot.source,sourceRead:!values.archive,archive:out,sha256:digest(encrypted),tables:snapshot.tables.map(t=>({name:t.name,rows:t.rows.length})),localIntegrity:'ok',rehearsal:values.rehearse?'pending':'not-requested'}
 const reportPath=join(directory,`production-${stamp}.report.json`)
 const saveReport=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600})
 await saveReport()
 console.log('Encrypted snapshot and local integrity verification complete. Credential values withheld.')
 if(values.rehearse) await rehearseSnapshot({snapshot:archiveSnapshot,config,token,report,saveReport,onStage:value=>{stage=value}})
 console.log(JSON.stringify({archive:out,report:reportPath,tableCount:snapshot.tables.length,rehearsal:report.rehearsal}))
}
try {await main()} catch {console.error('Backup/rehearsal failed at '+stage+'; no success claimed. Inspect the private report for a created rehearsal database. Provider and data diagnostics intentionally withheld.');process.exitCode=1}
