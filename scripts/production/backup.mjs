import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

// Bounded first-release backup. Never paginate a live DB and call it a snapshot.
export const MAX_BACKUP_BYTES = 1024 * 1024
const shadow = ['service_search_data', 'service_search_idx', 'service_search_content', 'service_search_docsize', 'service_search_config']
const id = (s) => { assert.match(s, /^[a-zA-Z_][a-zA-Z_0-9]*$/, 'Unsupported SQL identifier'); return `"${s}"` }
const str = (s) => `'${s.replaceAll("'", "''")}'`
const schemaSelect = `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT IN (${shadow.map(str).join(',')}) ORDER BY type,name`
const schemaJSON = `(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${schemaSelect}))`
export const inventorySQL = `SELECT ${schemaJSON} AS schema_json`
export const rebuildSearchSQL = `INSERT INTO service_search(queue_id,service_name,venue_name,address) SELECT q.id,q.name,v.name,COALESCE(v.address_formatted,'') FROM queue q JOIN venue v ON v.id=q.venue_id;`
export function baseTables(schema) {
  const virtual = schema.filter(s => /^CREATE VIRTUAL TABLE/i.test(s.sql))
  assert.equal(virtual.length, 1, 'Exactly the known derived FTS index is supported')
  assert.equal(virtual[0].name, 'service_search', 'Unknown virtual table; backup unsupported')
  assert.match(virtual[0].sql, /USING fts5\(queue_id UNINDEXED, service_name, venue_name, address, tokenize='unicode61 remove_diacritics 2'\)/i, 'Unknown FTS recipe')
  assert.ok(schema.every(s => ['table','index','trigger','view'].includes(s.type)), 'Unknown schema object')
  return schema.filter(s => s.type === 'table' && s.name !== 'service_search')
}
// No UNION chain: D1's optimizer can flatten nested groups past its 50-term limit.
// Group JSON arguments too, to remain below D1's function-argument limit.
const groupedJSON = parts => {
  const groups=[]
  for(let i=0;i<parts.length;i+=20) groups.push(`json_array(${parts.slice(i,i+20).join(',')})`)
  return `json_array(${groups.join(',')})`
}
export function columnsSQL(schema) {
  const parts=baseTables(schema).map(t => `json((SELECT json_group_array(json_object('tbl',${str(t.name)},'name',name,'hidden',hidden)) FROM (SELECT name,hidden FROM pragma_table_xinfo(${str(t.name)}) ORDER BY cid)))`)
  return `SELECT ${groupedJSON(parts)} AS columns_json`
}
export const parseColumns = row => JSON.parse(row.columns_json).flat(2)
function literal(column) {
  const c = id(column)
  // quote(TEXT) truncates at embedded NUL; hex also avoids newlines/SQL injection.
  // Numeric values stay in SQLite, not JS Number (int64 precision).
  // X'...'||'' evaluates to TEXT (including embedded NUL), avoiding the longer
  // CAST(X'...' AS TEXT) form in every column of the bounded snapshot query.
  // Keep the type branch: numbers/blobs must remain SQLite literals, not text.
  return `iif(typeof(${c})='text','X'''||hex(${c})||'''||''''',quote(${c}))`
}
export function snapshotSQL(schema, columns) {
  const tables = baseTables(schema)
  const parts = tables.map(t => {
    const cols = columns.filter(c => c.tbl === t.name)
    assert.ok(cols.length && cols.every(c => c.hidden === 0), 'Generated/hidden columns require backup review')
    assert.ok(!/WITHOUT ROWID/i.test(t.sql), 'WITHOUT ROWID requires backup review')
    assert.ok(!cols.some(c => ['rowid','_rowid_','oid'].includes(c.name.toLowerCase())), 'Shadowed rowid unsupported')
    const names = ['_rowid_', ...cols.map(c => c.name)]
    const prefix = `INSERT INTO ${id(t.name)}(${names.map(id).join(',')}) VALUES (`
    const expression = `${str(prefix)}||${names.map(literal).join("||','||")}||');'`
    return `json_object('name',${str(t.name)},'rows',json((SELECT COALESCE(json_group_array(stmt),'[]') FROM (SELECT ${expression} AS stmt FROM ${id(t.name)} ORDER BY _rowid_))))`
  })
  // Single statement = one SQLite read snapshot. Include schema in that same read.
  const sql = `SELECT ${schemaJSON} AS schema_json,${groupedJSON(parts)} AS tables_json,(SELECT json_group_array(json_object('name',name,'seq',CAST(seq AS TEXT))) FROM sqlite_sequence WHERE name IN (${tables.map(t => str(t.name)).join(',')})) AS sequences_json`
  assert.ok(Buffer.byteLength(sql) <= 95000, 'Snapshot SQL exceeds bounded D1 query size; do not paginate')
  return sql
}
export function assembleSnapshot(schema, row, source) {
  assert.equal(row.schema_json, JSON.stringify(schema), 'Schema changed during snapshot preparation; retry without writes')
  const snapshot = { format: 'noqueue-d1-logical-v1', capturedAt: new Date().toISOString(), source, schema, tables: JSON.parse(row.tables_json).flat(), sequences: JSON.parse(row.sequences_json) }
  assert.deepEqual(snapshot.tables.map(t => t.name), baseTables(schema).map(t => t.name), 'Missing tables')
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_BACKUP_BYTES, 'Snapshot exceeds first-release 1 MiB limit; no backup written')
  return snapshot
}
export function restoreStatements(snapshot) {
  assert.equal(snapshot.format, 'noqueue-d1-logical-v1', 'Unknown backup format')
  const tables = baseTables(snapshot.schema)
  assert.deepEqual(snapshot.tables.map(t => t.name), tables.map(t => t.name), 'Incomplete backup')
  const ddl = type => snapshot.schema.filter(s => s.type === type).map(s => s.sql + ';')
  return [
    'PRAGMA defer_foreign_keys=ON;',
    ...tables.map(t => t.sql + ';'),
    ...ddl('index'),
    ...snapshot.tables.flatMap(t => t.rows),
    ...snapshot.schema.filter(s => s.name === 'service_search').map(s => s.sql + ';'),
    rebuildSearchSQL,
    ...ddl('view'), ...ddl('trigger'),
    "DELETE FROM sqlite_sequence WHERE name NOT GLOB '_cf_*';",
    ...snapshot.sequences.map(s => { assert.match(s.seq, /^\d+$/); return `INSERT INTO sqlite_sequence(name,seq) VALUES (${str(s.name)},${s.seq});` }),
  ]
}
export function encryptSnapshot(snapshot, key) {
  assert.equal(key.length,32)
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv)
  cipher.setAAD(Buffer.from('noqueue-d1-backup-v1'))
  const data = Buffer.concat([cipher.update(JSON.stringify(snapshot),'utf8'),cipher.final()])
  return Buffer.from(JSON.stringify({format:'noqueue-d1-backup-v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')})+'\n')
}
export function decryptSnapshot(encrypted,key) {
  try {
    const e=JSON.parse(encrypted);assert.equal(e.format,'noqueue-d1-backup-v1');assert.equal(key.length,32)
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'))
    decipher.setAAD(Buffer.from(e.format));decipher.setAuthTag(Buffer.from(e.tag,'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data,'base64')),decipher.final()]).toString('utf8'))
  } catch { throw new Error('Backup authentication/decryption failed; details withheld') }
}
export const digest = data => createHash('sha256').update(data).digest('hex')
