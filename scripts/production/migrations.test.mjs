import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { migrationInventory, migrationsDirectory, pendingMigrations, migrationPlan } from './migrations.mjs'
const inventory = migrationInventory()
function apply(db, start, end) {
  for (const item of inventory.slice(start, end)) {
    db.exec('BEGIN')
    try { db.exec(readFileSync(new URL(item.name, migrationsDirectory), 'utf8')); db.exec('COMMIT') }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
}
function baseline(count = 28) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  apply(db, 0, count)
  for (let i = 1; i <= 6; i++) db.prepare(`INSERT INTO queue_entry
    (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,status,created_at,sequence)
    VALUES (?,'demo-queue',?,?,?, ?,2,'es',?,100,?)`).run(`entry-${i}`, `key-${i}`, `req-${i}`, `recovery-${i}`, `CODE${i}`, i === 6 ? 'called' : 'waiting', i)
  return db
}
const quote = name => '"' + name.replaceAll('"', '""') + '"'
function originalRows(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => quote(row.name)).join(',')
    const sql = `SELECT ${columns} FROM ${quote(name)} ORDER BY 1`
    return { name, sql, rows: db.prepare(sql).all() }
  })
}
test('offline inventory identifies precisely 12 unchanged migrations and rejects incomplete/unknown ledgers', () => {
  const plan = migrationPlan()
  assert.equal(plan.remoteRead, false)
  assert.equal(plan.applied, false)
  assert.equal(plan.pending.length, 12)
  assert.equal(plan.pending[0].name, '0029_mobile_installations.sql')
  assert.equal(plan.pending.at(-1).name, '0040_automation_attention.sql')
  for (const row of plan.inventory) assert.match(row.sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(pendingMigrations(inventory.map(({ name }) => ({ name }))), [])
  for (const invalid of [[inventory[1].name], [inventory[0].name, inventory[0].name], ['unknown.sql']]) assert.throws(() => pendingMigrations(invalid))
})
test('incremental 0028→0040 preserves every existing row/column including WhatsApp, privacy and queued deliveries', () => {
  const db = baseline()
  try {
    const statuses = ['pending', 'sending', 'unknown', 'failed', 'read', 'cancelled']
    statuses.forEach((status, index) => {
      const id = `entry-${index + 1}`
      db.prepare('INSERT INTO queue_entry_contact VALUES (?,?,?)').run(id, `synthetic-cipher-${index}`, `synthetic-hash-${index}`)
      db.prepare("INSERT INTO consent VALUES (?,?, 'demo-org','whatsapp','4',123,NULL)").run(`consent-${index}`, id)
      db.prepare(`INSERT INTO notification_outbox (id,entry_id,idempotency_key,status,provider_id,attempts,next_attempt_at,updated_at,payload_version,payload_snapshot)
        VALUES (?,?,?,?,?,2,200,150,2,?)`).run(`notice-${index}`, id, `notice-key-${index}`, status, `synthetic-provider-${index}`, '{"fixture":true}')
    })
    db.exec(`INSERT INTO webhook_event (id,dedupe_key,kind,provider_id,status,phone_hash,occurred_at,received_at,processed_at) VALUES ('hook','dedupe','status','synthetic-provider-4','read','synthetic-hash',110,120,NULL);
      INSERT INTO whatsapp_contact_state VALUES ('synthetic-hash',111,112);
      INSERT INTO privacy_consent_receipt VALUES ('decision','consent','https://app.noqueue-app.com',1,'es',0,100);`)
    const before = originalRows(db)
    apply(db, 28, 40)
    for (const item of before) assert.deepEqual(db.prepare(item.sql).all(), item.rows, `Preserve ${item.name}`)
    for (const name of ['mobile_entry_installation', 'mobile_push_registration', 'mobile_push_outbox', 'mobile_push_state', 'queue_call_replacement', 'queue_replacement_decision', 'queue_automation_cycle', 'queue_automation_attention'])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${name}`).get().n, 0, `No synthetic backfill in ${name}`)
    assert.equal(db.prepare('SELECT count(*) n FROM queue_entry WHERE manual_only<>0 OR whatsapp_suppressed<>0').get().n, 0)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.equal(db.prepare("SELECT count(*) n FROM service_search WHERE service_search MATCH 'Demo'").get().n, 2)
  } finally { db.close() }
})
test('0031 aborts duplicate active installation migration without cancelling customer turns', () => {
  const db = baseline(30), hash = 'a'.repeat(64)
  try {
    for (const id of ['entry-1', 'entry-2']) db.prepare('INSERT INTO mobile_entry_installation VALUES (?,?,100)').run(id, hash)
    const before = originalRows(db)
    assert.throws(() => apply(db, 30, 31), /CHECK constraint failed/)
    for (const item of before) assert.deepEqual(db.prepare(item.sql).all(), item.rows)
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='mobile_single_turn_preflight'").get().n, 0)
  } finally { db.close() }
})
test('0032/0033 retire only APNs queued tokens, preserve FCM IDs/outcomes and never replay history', () => {
  const db = baseline(31)
  try {
    for (const [index, provider, status] of [[1,'apns','pending'],[2,'apns','accepted'],[3,'fcm','sending'],[4,'fcm','failed']]) {
      const hash = String(index).repeat(64), id = String(index).repeat(32)
      db.prepare('INSERT INTO mobile_entry_installation VALUES (?,?,100)').run(`entry-${index}`, hash)
      db.prepare("INSERT INTO mobile_push_registration VALUES (?,?,?,?,'es',1,100)").run(hash, provider, `hash-${index}`, `cipher-${index}`)
      db.prepare(`INSERT INTO mobile_push_outbox (id,entry_id,installation_hash,entry_version,kind,status,attempts,next_attempt_at,expires_at,created_at)
        VALUES (?,?,?,1,'called',?,2,101,999,100)`).run(id, `entry-${index}`, hash, status)
    }
    apply(db, 31, 40)
    const rows = db.prepare('SELECT id,status,last_error,event_key,attempts FROM mobile_push_outbox ORDER BY id').all()
    assert.deepEqual(rows.map(r => r.status), ['discarded','accepted','sending','failed'])
    assert.equal(rows[0].last_error, 'transport_migration')
    for (const row of rows) { assert.equal(row.event_key, 'legacy:' + row.id); assert.equal(row.attempts, 2) }
    assert.equal(db.prepare("SELECT count(*) n FROM mobile_push_registration WHERE provider='apns'").get().n, 0)
    assert.equal(db.prepare("SELECT count(*) n FROM mobile_push_registration WHERE provider='fcm' AND platform='android'").get().n, 2)
    assert.equal(db.prepare('SELECT count(*) n FROM mobile_entry_installation').get().n, 4)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { db.close() }
})
