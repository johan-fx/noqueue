import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import type { QueueCommand, ServiceInput } from '@noqueue/contracts/staff'
import { runQueueCommand } from '../staff/commands'
import { serviceWindow } from '../staff/availability'
import { encryptDisplayName, hash } from './crypto'
import { expireArrivals } from './customer'

const enabled = { ...env, QUEUE_AUTO_REPLACEMENT_ENABLED: 'true' }
afterEach(() => vi.restoreAllMocks())

async function fixture(
  sizes = [4, 5, 3],
  type: ServiceInput['type'] = 'pool',
  receptionSubtypes: Array<'check_in' | 'check_out' | 'other'> = [],
  automaticAssignmentEnabled = true,
) {
  const now = Date.now()
  const queueId = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const config: ServiceInput = {
    name: 'Staff interaction test',
    type,
    capacity: 99,
    averageMinutes: 4,
    graceMinutes: 3,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: type === 'reception'
      ? [...new Set(receptionSubtypes)]
      : [],
    spaces: type === 'restaurant'
      ? [{ id: 'test-space', name: 'Test space', tables: 1, tableTypes: [{ seats: 20, count: 1 }] }]
      : [],
    estimatorVersion: 2,
    estimationMode: 'active',
    approachMinutes: 0,
    automaticAssignmentEnabled,
  }
  const windowId = serviceWindow(config, 'Europe/Madrid', new Date(now)).windowId!
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Test',?,datetime('now'),datetime('now'),'user')",
    ).bind(actor, `${actor}@staff-interactions.invalid`),
    env.DB.prepare(
      "INSERT OR IGNORE INTO tenant_account(organization_id,created_by,status) VALUES ('demo-org',?,'active')",
    ).bind(actor),
    env.DB.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,'demo-org',?,'owner',datetime('now'))",
    ).bind(crypto.randomUUID(), actor),
    env.DB.prepare(
      "INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,'demo-venue','owner')",
    ).bind(actor),
    env.DB.prepare(
      "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes,open) VALUES (?,'demo-venue','Staff interactions',?,99,4,1)",
    ).bind(queueId, JSON.stringify(config)),
    env.DB.prepare(
      "INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)",
    ).bind(queueId, windowId, now),
  ])
  const ids: string[] = []
  for (const [index, partySize] of sizes.entries()) {
    const id = crypto.randomUUID()
    ids.push(id)
    await env.DB.prepare(
      `INSERT INTO queue_entry
        (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,reception_service)
       VALUES (?,?,?,?,?,?,?,'es',?,?,?)`,
    ).bind(
      id,
      queueId,
      id,
      id,
      await hash(id),
      id,
      partySize,
      now,
      index + 1,
      receptionSubtypes[index] ?? null,
    ).run()
  }
  const row = async (id: string) =>
    env.DB.prepare(
      'SELECT id,status,version,sequence,call_cycle,priority_rank FROM queue_entry WHERE id=?',
    ).bind(id).first<{
      id: string
      status: string
      version: number
      sequence: number
      call_cycle: number
      priority_rank: number | null
    }>()
  const command = async (
    action: 'pass' | 'prioritize' | 'call' | 'assign_next' | 'complete' | 'cancel',
    id: string,
    version?: number,
    key = crypto.randomUUID(),
    arrivalMode?: 'notify' | 'present',
  ) => {
    const resolvedVersion = version ?? (await row(id))?.version
    if (resolvedVersion === undefined) throw new Error('missing_entry')
    const body: QueueCommand = action === 'assign_next'
      ? { action, expectedEntryId: id, expectedVersion: resolvedVersion }
      : { action, entryId: id, version: resolvedVersion, ...(arrivalMode ? { arrivalMode } : {}) }
    return runQueueCommand(enabled, actor, queueId, key, body, now)
  }
  return { actor, queueId, ids, row, command, now }
}

it('prioritizes a waiting party once and assigns the priority before FIFO', async () => {
  const f = await fixture([2, 4])
  const prioritized = await f.command('prioritize', f.ids[1]!)
  expect(prioritized).toMatchObject({
    ok: true,
    outcome: { action: 'prioritize', mode: 'prioritized', automatic: false },
  })
  expect(await f.row(f.ids[1]!)).toMatchObject({
    priority_rank: 1,
    version: 1,
    status: 'waiting',
  })

  const repeated = await f.command('prioritize', f.ids[1]!)
  expect(repeated).toMatchObject({
    outcome: { mode: 'already_prioritized' },
  })
  const assigned = await f.command('assign_next', f.ids[1]!, 1)
  expect(assigned).toMatchObject({ ok: true })
  expect(await f.row(f.ids[1]!)).toMatchObject({
    status: 'called',
    priority_rank: null,
  })
  expect(await f.row(f.ids[0]!)).toMatchObject({ status: 'waiting' })
})

it('keeps multiple priorities FIFO and serves a prioritized smaller party before a larger FIFO party', async () => {
  const f = await fixture([5, 2, 3])
  await f.command('prioritize', f.ids[1]!)
  await f.command('prioritize', f.ids[2]!)
  const first = await f.command('assign_next', f.ids[1]!, 1)
  expect(first).toMatchObject({ ok: true })
  expect(await f.row(f.ids[1]!)).toMatchObject({ status: 'called' })

  const second = await f.command('assign_next', f.ids[2]!, 1)
  expect(second).toMatchObject({ ok: true })
  expect(await f.row(f.ids[2]!)).toMatchObject({ status: 'called' })
  expect(await f.row(f.ids[0]!)).toMatchObject({ status: 'waiting' })
})

it('returns and replays a rich outcome for the quick assign-next CTA', async () => {
  const f = await fixture([2, 3])
  const key = crypto.randomUUID()
  const result = await f.command('assign_next', f.ids[0]!, undefined, key)
  expect(result).toMatchObject({
    ok: true,
    outcome: {
      operationId: expect.any(String),
      action: 'call',
      entry: { id: f.ids[0], code: f.ids[0], displayName: null },
      automatic: true,
      cycleEnded: false,
      mode: 'called',
    },
  })
  expect(await f.command('assign_next', f.ids[0]!, 0, key)).toEqual(result)
  const saved = await env.DB.prepare(
    'SELECT result FROM staff_command WHERE actor_id=? AND request_key=?',
  ).bind(f.actor, key).first<{ result: string }>()
  expect(JSON.parse(saved!.result)).toEqual(result)
})

it('reports a manual present call without starting an automatic cycle', async () => {
  const f = await fixture([2])
  const result = await f.command('call', f.ids[0]!, undefined, crypto.randomUUID(), 'present')
  expect(result).toMatchObject({
    outcome: {
      action: 'call',
      entry: { id: f.ids[0] },
      automatic: false,
      cycleEnded: false,
      mode: 'present',
    },
  })
  expect(await f.row(f.ids[0]!)).toMatchObject({ status: 'completed' })
  expect(await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM queue_automation_cycle WHERE queue_id=?',
  ).bind(f.queueId).first()).toEqual({ count: 0 })
})

it('reports no automatic cycle when assignment is disabled and canceling it does not claim to end one', async () => {
  const f = await fixture([2], 'pool', [], false)
  const call = await f.command('call', f.ids[0]!)
  expect(call).toMatchObject({ outcome: { automatic: false, cycleEnded: false, mode: 'called' } })
  const called = await f.row(f.ids[0]!)
  const key = crypto.randomUUID()
  const cancelled = await f.command('cancel', f.ids[0]!, called!.version, key)
  expect(cancelled).toMatchObject({
    outcome: {
      action: 'cancel',
      entry: { id: f.ids[0] },
      automatic: false,
      cycleEnded: false,
      mode: 'cancelled',
    },
  })
  expect(await f.command('cancel', f.ids[0]!, called!.version, key)).toEqual(cancelled)
})

it('reports a restaurant call with missing automatic context as manual-only for replacement', async () => {
  const f = await fixture([2], 'restaurant')
  const result = await f.command('call', f.ids[0]!)
  expect(result).toMatchObject({
    outcome: {
      action: 'call',
      automatic: false,
      cycleEnded: false,
      mode: 'called',
    },
  })
  expect(await env.DB.prepare(
    'SELECT state,reason FROM queue_automation_cycle WHERE queue_id=?',
  ).bind(f.queueId).first()).toEqual({ state: 'stopped', reason: 'missing_context' })
})

it('returns persisted cycle-ending outcomes for complete and cancel', async () => {
  const completed = await fixture([2])
  await completed.command('call', completed.ids[0]!)
  const calledForCompletion = await completed.row(completed.ids[0]!)
  const completeKey = crypto.randomUUID()
  const completion = await completed.command('complete', completed.ids[0]!, calledForCompletion!.version, completeKey)
  expect(completion).toMatchObject({
    outcome: {
      action: 'complete',
      entry: { id: completed.ids[0] },
      automatic: false,
      cycleEnded: true,
      mode: 'completed',
    },
  })
  expect(await completed.command('complete', completed.ids[0]!, calledForCompletion!.version, completeKey)).toEqual(completion)

  const cancelled = await fixture([2])
  await cancelled.command('call', cancelled.ids[0]!)
  const calledForCancellation = await cancelled.row(cancelled.ids[0]!)
  const cancellation = await cancelled.command('cancel', cancelled.ids[0]!, calledForCancellation!.version)
  expect(cancellation).toMatchObject({
    outcome: {
      action: 'cancel',
      entry: { id: cancelled.ids[0] },
      automatic: false,
      cycleEnded: true,
      mode: 'cancelled',
    },
  })
})

it('passes a waiting party by swapping with the next compatible effective-order party', async () => {
  const f = await fixture([4, 5, 3], 'restaurant')
  const key = crypto.randomUUID()
  await env.DB.prepare(
    'UPDATE queue_entry SET priority_rank=7 WHERE id=?',
  ).bind(f.ids[0]!).run()
  const result = await f.command('pass', f.ids[0]!, 0, key)
  expect(await f.command('pass', f.ids[0]!, 0, key)).toEqual(result)
  expect(result).toMatchObject({
    outcome: {
      action: 'pass',
      successor: { id: f.ids[2] },
      automatic: false,
      cycleEnded: false,
      mode: 'waiting_swap',
    },
  })
  expect(
    (await env.DB.prepare(
      'SELECT id,sequence,version,priority_rank FROM queue_entry WHERE queue_id=? ORDER BY sequence',
    ).bind(f.queueId).all()).results,
  ).toMatchObject([
    { id: f.ids[2], sequence: 1, version: 1 },
    { id: f.ids[1], sequence: 2, version: 0 },
    { id: f.ids[0], sequence: 3, version: 1, priority_rank: null },
  ])
  expect(await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM queue_automation_cycle WHERE queue_id=?',
  ).bind(f.queueId).first()).toEqual({ count: 0 })
})

it('skips other reception subtypes when passing a waiting party', async () => {
  const f = await fixture([2, 2, 2], 'reception', [
    'check_in',
    'check_out',
    'check_in',
  ])
  const result = await f.command('pass', f.ids[0]!)
  expect(result).toMatchObject({
    outcome: {
      successor: { id: f.ids[2] },
      mode: 'waiting_swap',
    },
  })
})

it('rejects a waiting pass when there is no candidate of the same reception subtype', async () => {
  const f = await fixture([2, 2], 'reception', ['check_in', 'check_out'])
  await expect(f.command('pass', f.ids[0]!)).rejects.toMatchObject({
    status: 409,
    message: 'no_compatible_successor',
  })
  expect(await f.row(f.ids[0]!)).toMatchObject({ status: 'waiting', sequence: 1 })
  expect(await f.row(f.ids[1]!)).toMatchObject({ status: 'waiting', sequence: 2 })
})

it('does not cap Bar / Pool waiting-pass compatibility by the source party size', async () => {
  const f = await fixture([2, 19])
  const result = await f.command('pass', f.ids[0]!)
  expect(result).toMatchObject({
    outcome: {
      successor: { id: f.ids[1] },
      mode: 'waiting_swap',
    },
  })
})

it('hands a called party to a compatible successor in the same automation cycle', async () => {
  const f = await fixture([2, 2])
  await f.command('call', f.ids[0]!)
  const called = await f.row(f.ids[0]!)
  const result = await f.command('pass', f.ids[0]!, called!.version)
  expect(result).toMatchObject({
    outcome: {
      action: 'pass',
      successor: { id: f.ids[1] },
      automatic: true,
      cycleEnded: false,
      mode: 'called_handoff',
    },
  })
  expect(await f.row(f.ids[0]!)).toMatchObject({
    status: 'waiting',
    sequence: 2,
    call_cycle: 2,
  })
  expect(await f.row(f.ids[1]!)).toMatchObject({
    status: 'called',
    sequence: 1,
    call_cycle: 1,
  })
  expect(
    await env.DB.prepare(
      'SELECT current_entry_id,state FROM queue_automation_cycle WHERE queue_id=?',
    ).bind(f.queueId).first(),
  ).toMatchObject({ current_entry_id: f.ids[1], state: 'active' })
  expect(
    await env.DB.prepare(
      "SELECT cause FROM queue_staff_event WHERE queue_id=? ORDER BY id DESC LIMIT 1",
    ).bind(f.queueId).first(),
  ).toMatchObject({ cause: 'staff_pass' })
  await expect(f.command('pass', f.ids[1]!, 0)).rejects.toMatchObject({
    status: 409,
    message: 'turn_automatically_assigned',
  })
  await expect(f.command('prioritize', f.ids[1]!, 0)).rejects.toMatchObject({
    status: 409,
    message: 'turn_automatically_assigned',
  })
})

it('stores only safe entry references and rehydrates names for authorized idempotent replays', async () => {
  const f = await fixture([2, 2])
  const currentName = 'Guest Alice'
  const successorName = 'Guest Bob'
  await env.DB.batch([
    env.DB.prepare('UPDATE queue_entry SET display_name_cipher=? WHERE id=?')
      .bind(await encryptDisplayName(env.PII_ENCRYPTION_KEY, currentName), f.ids[0]!),
    env.DB.prepare('UPDATE queue_entry SET display_name_cipher=? WHERE id=?')
      .bind(await encryptDisplayName(env.PII_ENCRYPTION_KEY, successorName), f.ids[1]!),
  ])
  await f.command('call', f.ids[0]!)
  const called = await f.row(f.ids[0]!)
  const key = crypto.randomUUID()
  const result = await f.command('pass', f.ids[0]!, called!.version, key)
  expect(result).toMatchObject({
    outcome: {
      entry: { id: f.ids[0], displayName: currentName },
      successor: { id: f.ids[1], displayName: successorName },
    },
  })

  const stored = await env.DB.prepare(
    'SELECT result FROM staff_command WHERE actor_id=? AND request_key=?',
  ).bind(f.actor, key).first<{ result: string }>()
  expect(stored!.result).not.toContain(currentName)
  expect(stored!.result).not.toContain(successorName)
  expect(JSON.parse(stored!.result)).toMatchObject({
    outcome: {
      entry: { id: f.ids[0], code: f.ids[0], displayName: null },
      successor: { id: f.ids[1], code: f.ids[1], displayName: null },
    },
  })
  expect(await f.command('pass', f.ids[0]!, called!.version, key)).toEqual(result)

  await env.DB.prepare(
    'UPDATE queue_entry SET display_name_cipher=NULL WHERE id IN (?,?)',
  ).bind(f.ids[0]!, f.ids[1]!).run()
  const afterDeletion = await f.command('pass', f.ids[0]!, called!.version, key)
  expect(afterDeletion).toMatchObject({
    outcome: {
      operationId: result.outcome?.operationId,
      entry: { id: f.ids[0], code: f.ids[0], displayName: null },
      successor: { id: f.ids[1], code: f.ids[1], displayName: null },
    },
  })
})

it('returns a called party to the same waiting position and stops its cycle without a successor', async () => {
  const f = await fixture([2])
  await f.command('call', f.ids[0]!)
  const called = await f.row(f.ids[0]!)
  const result = await f.command('pass', f.ids[0]!, called!.version)
  expect(result).toMatchObject({
    outcome: {
      successor: null,
      automatic: false,
      cycleEnded: true,
      mode: 'returned_to_waiting',
    },
  })
  expect(await f.row(f.ids[0]!)).toMatchObject({
    status: 'waiting',
    sequence: 1,
    call_cycle: 2,
  })
  expect(
    await env.DB.prepare(
      'SELECT state,reason FROM queue_automation_cycle WHERE queue_id=?',
    ).bind(f.queueId).first(),
  ).toMatchObject({ state: 'stopped', reason: 'no_candidate' })
})

it('allows a called retained party to pass back to waiting without creating an automatic cycle', async () => {
  const f = await fixture([2])
  await env.DB.prepare(
    "UPDATE queue_entry SET status='called',version=1,call_cycle=1,called_at=?,arrival_deadline_at=?,manual_only=1 WHERE id=?",
  ).bind(f.now, f.now + 60_000, f.ids[0]!).run()
  const result = await f.command('pass', f.ids[0]!, 1)
  expect(result).toMatchObject({
    outcome: {
      successor: null,
      automatic: false,
      cycleEnded: false,
      mode: 'returned_to_waiting',
    },
  })
  expect(await f.row(f.ids[0]!)).toMatchObject({ status: 'waiting', sequence: 1 })
  expect(await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM queue_automation_cycle WHERE queue_id=?',
  ).bind(f.queueId).first()).toEqual({ count: 0 })
})

it('requires queue.operate permission for pass operations', async () => {
  const f = await fixture([2, 2])
  const viewer = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Viewer',?,datetime('now'),datetime('now'),'user')",
    ).bind(viewer, `${viewer}@staff-interactions.invalid`),
    env.DB.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,'demo-org',?,'member',datetime('now'))",
    ).bind(crypto.randomUUID(), viewer),
    env.DB.prepare(
      "INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,'demo-venue','viewer')",
    ).bind(viewer),
  ])
  await expect(
    runQueueCommand(enabled, viewer, f.queueId, crypto.randomUUID(), {
      action: 'pass',
      entryId: f.ids[0]!,
      version: 0,
    }, f.now),
  ).rejects.toMatchObject({ status: 403, message: 'forbidden' })
})

it('labels a stale automatically expired command only with an actual expiry handoff event', async () => {
  const f = await fixture([2, 2])
  await f.command('call', f.ids[0]!)
  const called = await f.row(f.ids[0]!)
  await env.DB.prepare(
    'UPDATE queue_entry SET arrival_deadline_at=? WHERE id=?',
  ).bind(f.now, f.ids[0]!).run()
  await expireArrivals(enabled, f.queueId, f.now)
  expect(await f.row(f.ids[0]!)).toMatchObject({ status: 'expired' })
  expect(await env.DB.prepare(
    'SELECT cause FROM queue_staff_event WHERE queue_id=? ORDER BY id DESC LIMIT 1',
  ).bind(f.queueId).first()).toEqual({ cause: 'arrival_expiry' })
  await expect(f.command('pass', f.ids[0]!, called!.version)).rejects.toMatchObject({
    status: 409,
    message: 'turn_automatically_processed',
  })
})
