import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MAX_BACKUP_BYTES, restoreStatements, inventorySQL, columnsSQL, parseColumns, snapshotSQL, assembleSnapshot } from './backup.mjs'
import { sameRestoredRow } from './backup-local.mjs'

// D1 limits SQL per statement, not the sum of a transactional batch. Never
// split SQL on semicolons: trigger bodies and quoted literals contain them.
export function restoreBatchPlan(snapshot) {
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_BACKUP_BYTES, 'Snapshot exceeds 1 MiB')
  const statements = restoreStatements(snapshot)
  const sizes = statements.map(sql => Buffer.byteLength(sql))
  assert.ok(sizes.every(bytes => bytes <= 95000), 'Restore statement exceeds 95 kB; no remote restore attempted')
  const body = { batch: statements.map(sql => ({ sql })) }
  const requestBytes = Buffer.byteLength(JSON.stringify(body))
  assert.ok(requestBytes <= MAX_BACKUP_BYTES, 'Restore batch exceeds 1 MiB; never split into separate commits')
  return { body, summary: { transport: 'single-transactional-batch', statements: statements.length,
    sqlBytes: Buffer.byteLength(statements.join('\n')), maxStatementBytes: Math.max(...sizes), requestBytes } }
}
export function compareSnapshots(expected, actual) {
  const tables = actual.tables.length === expected.tables.length && actual.tables.every((table, i) => {
    const original = expected.tables[i]
    return table.name === original.name && table.rows.length === original.rows.length && table.rows.every((row, j) => sameRestoredRow(original.rows[j], row))
  })
  return { tables, schema: JSON.stringify(actual.schema) === JSON.stringify(expected.schema),
    sequences: JSON.stringify(actual.sequences) === JSON.stringify(expected.sequences) }
}

// The only writable target is a fresh UUID returned by THIS invocation. There
// is deliberately no target-id option and no network path to a live database.
export async function rehearseSnapshot({ snapshot, config, token, report, saveReport, request = fetch, onStage = () => {} }) {
  assert.ok(token, 'Authorized token required')
  assert.equal(config.account_id, snapshot.source.accountId)
  const protectedIds = new Set([snapshot.source.databaseId, ...[config, ...Object.values(config.env)].flatMap(e => (e.d1_databases ?? []).map(d => d.database_id))])
  const plan = restoreBatchPlan(snapshot)
  const name = `noqueue-backup-check-${new Date().toISOString().slice(0,10)}-${randomUUID()}`
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}`
  let targetId, stage = 'create isolated rehearsal database'
  const at = value => { stage = value; onStage(value) }
  async function api(path, method = 'GET', body, allowMissing = false) {
    if (path === '/d1/database') {
      assert.equal(method, 'POST'); assert.deepEqual(body, { name, jurisdiction: 'eu' })
      assert.equal(targetId, undefined, 'Never retry ambiguous database creation')
    } else {
      assert.ok(targetId && !protectedIds.has(targetId), 'Protected database cannot be accessed')
      assert.ok(path === `/d1/database/${targetId}` || path === `/d1/database/${targetId}/query`, 'Unexpected rehearsal endpoint')
    }
    let response, payload
    try {
      response = await request(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) })
      if (allowMissing && method === 'GET' && response.status === 404) return null
      payload = await response.json()
    } catch { throw new Error('Rehearsal request outcome unknown; no automatic retry') }
    if (!response.ok || payload.success !== true || (path.endsWith('/query') && (!Array.isArray(payload.result) || payload.result.some(r => r.success !== true || !Array.isArray(r.results))))) {
      const error = new Error('Rehearsal request failed; private diagnostics withheld')
      // Only classify the synthetic rollback probe. Never expose SQL/values.
      error.expectedProbeConstraint = JSON.stringify(payload.errors ?? []).includes('UNIQUE constraint failed: backup_atomicity_probe.id')
      throw error
    }
    return payload.result
  }
  const target = sql => api(`/d1/database/${targetId}/query`, 'POST', { sql })
  const batch = body => api(`/d1/database/${targetId}/query`, 'POST', body)
  const identity = async () => {
    const result = await api(`/d1/database/${targetId}`)
    assert.equal(result.name, name, 'Rehearsal name mismatch')
    assert.equal(result.uuid, targetId, 'Rehearsal UUID mismatch')
  }
  report.remoteRestore = plan.summary
  report.rehearsalDatabase = { name, creation: 'requested' }; await saveReport()
  at(stage)
  const created = await api('/d1/database', 'POST', { name, jurisdiction: 'eu' })
  assert.match(created.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  assert.ok(!protectedIds.has(created.uuid), 'Creation returned a protected database')
  targetId = created.uuid
  try {
    report.rehearsalDatabase = { name, id: targetId, jurisdiction: 'eu', deleted: false }; await saveReport()
    await identity()
    const empty = async () => assert.equal((await target(inventorySQL))[0].results[0].schema_json, '[]', 'Rehearsal database must be empty')
    await empty()
    at('prove remote batch rollback')
    let rolledBack = false
    try {
      await batch({ batch: [
        { sql: 'CREATE TABLE backup_atomicity_probe (id INTEGER PRIMARY KEY);' },
        { sql: 'INSERT INTO backup_atomicity_probe VALUES (1);' },
        { sql: 'INSERT INTO backup_atomicity_probe VALUES (1);' },
      ] })
    } catch (error) { if (!error.expectedProbeConstraint) throw error; rolledBack = true }
    assert.ok(rolledBack, 'Expected atomicity probe failure did not occur')
    await empty() // Proves DDL AND data rolled back, not merely a rejected insert.
    report.atomicRollbackProbe = 'passed'; await saveReport()
    at('restore isolated D1 in one batch')
    await batch(plan.body)
    at('capture restored database')
    const schema = JSON.parse((await target(inventorySQL))[0].results[0].schema_json)
    const columns = parseColumns((await target(columnsSQL(schema)))[0].results[0])
    const copy = assembleSnapshot(schema, (await target(snapshotSQL(schema, columns)))[0].results[0], { accountId: config.account_id, databaseId: targetId })
    at('compare restored data schema sequences')
    report.comparison = compareSnapshots(snapshot, copy); await saveReport()
    assert.ok(Object.values(report.comparison).every(Boolean), 'Restored snapshot differs')
    at('remote integrity and foreign keys')
    assert.equal((await target('PRAGMA foreign_key_check'))[0].results.length, 0)
    const quick = (await target('PRAGMA quick_check'))[0].results
    assert.ok(quick.length === 1 && quick[0].quick_check === 'ok')
    report.remoteQuickCheck = 'ok'; report.remoteForeignKeys = 'ok'
    at('remote FTS probes')
    const expected = (await target('SELECT count(*) n FROM queue q JOIN venue v ON v.id=q.venue_id'))[0].results[0].n
    assert.equal((await target('SELECT count(*) n FROM service_search'))[0].results[0].n, expected)
    // Synthetic rows only in the disposable database; triggers never run during data load.
    await target("INSERT INTO organization(id,name) VALUES ('backup-probe-org','Backup probe'); INSERT INTO venue(id,organization_id,name) VALUES ('backup-probe-venue','backup-probe-org','RespaldoFicticio'); INSERT INTO queue(id,venue_id,name,capacity,average_minutes) VALUES ('backup-probe-queue','backup-probe-venue','ServicioFicticio',2,5);")
    assert.equal((await target("SELECT count(*) n FROM service_search WHERE service_search MATCH 'RespaldoFicticio' AND queue_id='backup-probe-queue'"))[0].results[0].n, 1)
    await target("UPDATE venue SET name='RestauracionFicticia' WHERE id='backup-probe-venue'; UPDATE queue SET name='ServicioRestaurado' WHERE id='backup-probe-queue';")
    assert.equal((await target("SELECT count(*) n FROM service_search WHERE service_search MATCH 'RestauracionFicticia AND ServicioRestaurado' AND queue_id='backup-probe-queue'"))[0].results[0].n, 1)
    await target("DELETE FROM queue WHERE id='backup-probe-queue'")
    assert.equal((await target("SELECT count(*) n FROM service_search WHERE service_search MATCH 'ServicioRestaurado' AND queue_id='backup-probe-queue'"))[0].results[0].n, 0)
    report.ftsInsertUpdateDelete = 'passed'; report.rehearsal = 'verified-cleanup-pending'; await saveReport()
  } catch (error) {
    report.rehearsal = 'failed'; report.failedStage = stage; await saveReport(); throw error
  } finally {
    at('delete isolated rehearsal database')
    try {
      await identity()
      await api(`/d1/database/${targetId}`, 'DELETE')
      assert.equal(await api(`/d1/database/${targetId}`, 'GET', undefined, true), null, 'Database deletion not confirmed')
      report.rehearsalDatabase.deleted = true; report.rehearsalDatabase.deletionConfirmed = 'HTTP 404'; await saveReport()
    } catch (error) {
      report.rehearsal = 'cleanup-failed'; report.failedStage = stage; await saveReport(); throw error
    }
  }
  report.rehearsal = 'passed'; await saveReport()
}
