import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { MAX_BACKUP_BYTES, inventorySQL, columnsSQL, parseColumns, snapshotSQL, assembleSnapshot, restoreStatements } from './backup.mjs'

// SQLite releases may quote the SAME binary64 REAL with different decimal
// spellings. Permit exact numeric equality only for REAL literals; never coerce
// int64, NULL, blobs, hex-encoded text, identifiers or row ordering.
export function sameRestoredRow(expected, actual) {
  if (expected === actual) return true
  const split = row => {
    const at = row.indexOf(' VALUES (')
    if (at < 0 || !row.endsWith(');')) return null
    return { prefix: row.slice(0, at), values: row.slice(at + 9, -2).split(',') }
  }
  const a = split(expected), b = split(actual)
  if (!a || !b || a.prefix !== b.prefix || a.values.length !== b.values.length) return false
  const real = value => /^-?(?:\d+\.\d*(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/.test(value)
  return a.values.every((value, index) => value === b.values[index] ||
    (real(value) && real(b.values[index]) && Number.isFinite(Number(value)) && Object.is(Number(value), Number(b.values[index]))))
}

// Do not silently relax the existing single-request remote restore limit.
// The larger bound is ONLY for an explicitly local in-memory rehearsal.
export function validateRestoreSize(sql, { localOnly = false, rehearse = false } = {}) {
  assert.ok(!(localOnly && rehearse), '--local-only cannot create a remote rehearsal database')
  const bytes = Buffer.byteLength(sql)
  assert.ok(bytes <= (localOnly ? MAX_BACKUP_BYTES : 95000), localOnly
    ? 'Local restore exceeds the bounded 1 MiB limit'
    : 'Restore SQL exceeds supported 95 kB single-request limit; use explicit --local-only for a local-only backup, not remote recovery')
  return { bytes, remoteSingleRequestSupported: bytes <= 95000 }
}

// Never starts a Worker, provider or network client. Production data exists
// only in this process's memory; the caller persists the encrypted archive.
export function verifyLocalRestore(snapshot) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN;' + restoreStatements(snapshot).join('\n') + 'COMMIT;')
    const schema = JSON.parse(db.prepare(inventorySQL).get().schema_json)
    const columns = parseColumns(db.prepare(columnsSQL(schema)).get())
    const copy = assembleSnapshot(schema, db.prepare(snapshotSQL(schema, columns)).get(), snapshot.source)
    // Compare silently: assertion diagnostics must never expose customer data.
    for (const name of ['schema', 'sequences'])
      assert.ok(JSON.stringify(copy[name]) === JSON.stringify(snapshot[name]), `Local restored ${name} differs`)
    assert.equal(copy.tables.length, snapshot.tables.length)
    assert.ok(copy.tables.every((table, index) => {
      const expected = snapshot.tables[index]
      return table.name === expected.name && table.rows.length === expected.rows.length &&
        table.rows.every((row, i) => sameRestoredRow(expected.rows[i], row))
    }), 'Local restored tables differs')
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    const count = sql => db.prepare(sql).get().n
    assert.equal(count('SELECT count(*) n FROM service_search'), count('SELECT count(*) n FROM queue q JOIN venue v ON v.id=q.venue_id'))
    // Only the disposable local copy receives these probes. Roll them back.
    const id = 'backup-probe-' + randomUUID()
    db.exec('BEGIN')
    db.prepare('INSERT INTO organization(id,name) VALUES (?,?)').run(id, 'Backup probe')
    db.prepare('INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)').run(id, id, 'NoqueueBackupProbeOriginal')
    db.prepare('INSERT INTO queue(id,venue_id,name,capacity,average_minutes) VALUES (?,?,?,2,5)').run(id, id, 'NoqueueBackupProbeService')
    const matches = word => db.prepare('SELECT count(*) n FROM service_search WHERE service_search MATCH ? AND queue_id=?').get(word, id).n
    assert.equal(matches('NoqueueBackupProbeOriginal'), 1)
    db.prepare('UPDATE venue SET name=? WHERE id=?').run('NoqueueBackupProbeUpdated', id)
    db.prepare('UPDATE queue SET name=? WHERE id=?').run('NoqueueBackupProbeRenamed', id)
    assert.equal(matches('NoqueueBackupProbeUpdated AND NoqueueBackupProbeRenamed'), 1)
    assert.equal(matches('NoqueueBackupProbeOriginal'), 0)
    db.prepare('DELETE FROM queue WHERE id=?').run(id)
    assert.equal(matches('NoqueueBackupProbeRenamed'), 0)
    db.exec('ROLLBACK')
    return { target: 'local-memory', data: 'identical', schema: 'identical', sequences: 'identical', integrity: 'ok', foreignKeys: 'ok', ftsInsertUpdateDelete: 'passed' }
  } finally { db.close() }
}
