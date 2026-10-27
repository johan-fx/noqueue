// Offline inventory only. Never connects to D1 and never executes SQL.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
export const migrationsDirectory = new URL('../../apps/api/migrations/', import.meta.url)
export function migrationInventory() {
  return readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort().map((name, index) => {
    assert.equal(Number(name.slice(0, 4)), index + 1, 'Migration filenames must be contiguous')
    return { name, sha256: createHash('sha256').update(readFileSync(new URL(name, migrationsDirectory))).digest('hex') }
  })
}
export function pendingMigrations(applied, inventory = migrationInventory()) {
  assert.ok(Array.isArray(applied), 'Expected applied migration names')
  const names = applied.map(row => typeof row === 'string' ? row : row.name)
  assert.equal(new Set(names).size, names.length, 'Duplicate applied migrations')
  assert.deepEqual([...names].sort(), inventory.slice(0, names.length).map(row => row.name), 'Unknown migration or gap in applied ledger')
  return inventory.slice(names.length)
}
export function migrationPlan(applied) {
  const inventory = migrationInventory()
  const reference = applied ?? inventory.slice(0, 28).map(row => row.name)
  return { format: 'noqueue-migration-plan-v1', remoteRead: false, applied: false,
    baseline: applied ? 'supplied-ledger (not live-verified)' : '2026-10-27 read-only inventory: 0001–0028; recheck before apply',
    inventory, pending: pendingMigrations(reference, inventory) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Offline inventory accepts no remote/apply options')
  console.log(JSON.stringify(migrationPlan(), null, 2))
}
