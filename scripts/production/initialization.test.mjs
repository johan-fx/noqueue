import { DatabaseSync } from 'node:sqlite'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { initialAdminStatements } from '../../apps/api/scripts/production-initialization.mjs'
const directory = new URL('../../apps/api/migrations/', import.meta.url)
async function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const file of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort())
    db.exec(await readFile(new URL(file, directory), 'utf8'))
  return db
}
function statements(db, extra = {}) {
  return initialAdminStatements({ username: 'admin.production', name: 'Initial Admin', passwordHash: 'test-hash-not-a-real-password',
    tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name), ...extra })
}
function apply(db, sql) {
  db.exec(sql.create)
  try { db.exec(sql.insert) } finally { db.exec(sql.drop) }
}
test('all historical migrations + atomic initialization remove only demo rows and create one unverified admin', async () => {
  const db = await fixture()
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 2)
    apply(db, statements(db))
    for (const table of ['queue', 'venue', 'organization', 'service_search', 'queue_entry', 'privacy_consent_receipt'])
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table)
    assert.deepEqual({ ...db.prepare('SELECT username,role,emailVerified FROM user').get() }, { username: 'admin.production', role: 'platform_admin', emailVerified: 0 })
    const account = { ...db.prepare('SELECT * FROM account').get() }
    apply(db, statements(db, { passwordHash: 'another-test-hash', name: 'Changed' }))
    assert.deepEqual({ ...db.prepare('SELECT * FROM account').get() }, account, 'retry must not reset credentials')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { db.close() }
})
for (const [label, mutation] of [
  ['real establishment', "INSERT INTO organization(id,name) VALUES('real-org','Real organization')"],
  ['used demo turn', "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,status,created_at,sequence) VALUES('used','demo-queue','k','h','r','CODE',1,'es','cancelled',1,1)"],
  ['inventory activity', "INSERT INTO queue_inventory_audit(id,queue_id,actor_id,action,payload,created_at) VALUES('audit','demo-queue','operator','opened','{}',1)"],
  ['altered seed', "UPDATE queue SET config='{}' WHERE id='demo-queue'"],
  ['previous administrator', "INSERT INTO user(id,name,email,username,role,createdAt,updatedAt) VALUES('old','Old','old@example.invalid','other-admin','platform_admin','now','now')"],
  ['unrelated historical data', "INSERT INTO metrics_context(queue_id,at,origin) VALUES('deleted-queue',1,'test')"],
  ['new unknown nonempty table', 'CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES(\'preserve\')'],
]) test(`refuses ${label} without deleting seeds or leaving a partial admin`, async () => {
  const db = await fixture()
  try {
    db.exec(mutation)
    assert.throws(() => apply(db, statements(db)), /production_not_empty/)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user WHERE username='admin.production'").get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 2)
  } finally { db.close() }
})
test('a later credential insert failure rolls back seed removal and user creation', async () => {
  const db = await fixture()
  try {
    db.exec("CREATE TRIGGER reject_credential BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT,'test_failure'); END;")
    assert.throws(() => apply(db, statements(db)), /test_failure/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 2)
  } finally { db.close() }
})
test('incomplete schemas and unsafe identifiers fail before SQL execution', () => {
  assert.throws(() => initialAdminStatements({ username: 'abc', name: 'Admin', passwordHash: 'x', tables: [] }), /migrations/)
  assert.throws(() => initialAdminStatements({ username: "bad'name", name: 'Admin', passwordHash: 'x', tables: [] }), /Invalid/)
})
test('concurrent initializers cannot create two administrators', async () => {
  const db = await fixture()
  try {
    const first = statements(db), second = statements(db, { username: 'another.admin' })
    db.exec(first.create); db.exec(second.create)
    try {
      db.exec(first.insert)
      assert.throws(() => db.exec(second.insert), /production_not_empty/)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account').get().n, 1)
    } finally { db.exec(first.drop); db.exec(second.drop) }
  } finally { db.close() }
})
