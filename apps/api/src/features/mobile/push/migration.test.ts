import { env } from 'cloudflare:workers'
import { applyD1Migrations } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('preserves legacy IDs, outcomes and routing ownership without replay, and replaces the restrictive trigger/key', async () => {
  const db = (env as typeof env & { AUTH_ISOLATION_DB: D1Database }).AUTH_ISOLATION_DB
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter(m => !m.name.startsWith('0033')))
  const queue = (await db.prepare('SELECT id FROM queue LIMIT 1').first<{ id: string }>())!.id
  const entry = crypto.randomUUID(), owner = 'a'.repeat(64), pending = '1'.repeat(32), accepted = '2'.repeat(32)
  await db.batch([
    db.prepare("INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,'MIGRATE',1,'es',1,1)").bind(entry,queue,entry,entry,entry),
    db.prepare('INSERT INTO mobile_entry_installation(entry_id,installation_hash,created_at) VALUES (?,?,1)').bind(entry,owner),
    db.prepare("INSERT INTO mobile_push_outbox(id,entry_id,installation_hash,entry_version,kind,next_attempt_at,expires_at,created_at) VALUES (?,?,?,1,'called',1,9999999999999,1)").bind(pending,entry,owner),
    db.prepare("INSERT INTO mobile_push_outbox(id,entry_id,installation_hash,entry_version,kind,status,attempts,next_attempt_at,expires_at,created_at,accepted_at) VALUES (?,?,?,0,'called','accepted',1,1,2,1,2)").bind(accepted,entry,owner),
  ])
  await applyD1Migrations(db, env.TEST_MIGRATIONS)
  expect((await db.prepare('SELECT id,status,attempts,payload_version,event_key FROM mobile_push_outbox ORDER BY id').all()).results).toEqual([
    {id:pending,status:'pending',attempts:0,payload_version:1,event_key:'legacy:'+pending},
    {id:accepted,status:'accepted',attempts:1,payload_version:1,event_key:'legacy:'+accepted},
  ])
  expect(await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='mobile_push_transition'").first()).toBeNull()
  expect(await db.prepare('SELECT 1 FROM mobile_push_state').first()).toBeNull()
  expect(await db.prepare('SELECT installation_hash FROM mobile_entry_installation WHERE entry_id=?').bind(entry).first()).toEqual({installation_hash:owner})
  for (const sequence of [1,2]) await db.prepare("INSERT INTO mobile_push_outbox(id,entry_id,installation_hash,entry_version,kind,next_attempt_at,expires_at,created_at,payload_version,event_key) VALUES (?,?,?,1,'delayed',1,2,1,2,?)")
    .bind(String(sequence+2).repeat(32),entry,owner,`extension:${sequence}`).run()
  expect((await db.prepare("SELECT COUNT(*) n FROM mobile_push_outbox WHERE kind='delayed'").first())?.n).toBe(2)
})
