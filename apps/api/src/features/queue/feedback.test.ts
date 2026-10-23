import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { createAuth } from '../../auth/server'
import { app } from '../../app'
import { encryptDisplayName } from './crypto'
import { readQueueFeedback } from './feedback'
import { readAutomation } from './automation'
import { expireArrivals } from './customer'
import { serviceWindow } from '../staff/availability'

const minute = 60_000
const enabled = { ...env, QUEUE_AUTO_REPLACEMENT_ENABLED: 'true' }
afterEach(() => vi.restoreAllMocks())

async function queueFixture(automaticAssignmentEnabled = true) {
  const queueId = crypto.randomUUID()
  const now = Date.now()
  const config: ServiceInput = {
    name: 'Feedback test',
    type: 'reception',
    capacity: 99,
    averageMinutes: 4,
    graceMinutes: 3,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: ['other'],
    estimationMode: 'active',
    estimatorVersion: 2,
    approachMinutes: 0,
    automaticAssignmentEnabled,
    spaces: [],
  }
  await env.DB.prepare(
    "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes,open) VALUES (?,'demo-venue','Feedback test',?,99,4,1)",
  ).bind(queueId, JSON.stringify(config)).run()
  return { queueId, now, config }
}

async function addEntry(
  queueId: string,
  sequence: number,
  options: {
    id?: string
    status?: string
    callCycle?: number
    arrivalDeadlineAt?: number | null
    displayName?: string | null
    receptionService?: string | null
  } = {},
) {
  const id = options.id ?? crypto.randomUUID()
  const cipher = options.displayName
    ? await encryptDisplayName(env.PII_ENCRYPTION_KEY, options.displayName)
    : null
  const called = options.status === 'called'
  await env.DB.prepare(
    `INSERT INTO queue_entry(
      id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,
      created_at,sequence,status,version,call_cycle,called_at,arrival_deadline_at,
      reception_service,display_name_cipher
    ) VALUES (?,?,?,?,?,?,1,'en',?,?,?,?,?,?,?, ?,?)`,
  ).bind(
    id,
    queueId,
    `key:${id}`,
    `hash:${id}`,
    `recovery:${id}`,
    `code:${id}`,
    Date.now(),
    sequence,
    options.status ?? 'waiting',
    called ? 1 : 0,
    options.callCycle ?? 0,
    called ? Date.now() : null,
    options.arrivalDeadlineAt ?? null,
    options.receptionService ?? 'other',
    cipher,
  ).run()
  return id
}

async function addCycle(
  queueId: string,
  entryId: string,
  cycleId = crypto.randomUUID(),
  callCycle = 1,
) {
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO queue_automation_cycle(
    id,queue_id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,
    service_type,reception_service,state,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,'reception','other','active',?,?)`)
    .bind(cycleId, queueId, entryId, callCycle, entryId, callCycle, now, now)
    .run()
  return cycleId
}

async function addEvent(
  queueId: string,
  entryId: string,
  successorEntryId: string,
  cycleId: string,
  callCycle = 1,
  cause: 'arrival_expiry' | 'customer_cancel' | 'customer_yield' | 'staff_pass' = 'staff_pass',
) {
  await env.DB.prepare(`INSERT INTO queue_staff_event(
    queue_id,entry_id,call_cycle,cycle_id,successor_entry_id,successor_call_cycle,cause,created_at
  ) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(queueId, entryId, callCycle, cycleId, successorEntryId, callCycle, cause, Date.now())
    .run()
  return env.DB.prepare('SELECT id FROM queue_staff_event WHERE queue_id=? ORDER BY id DESC LIMIT 1')
    .bind(queueId).first<{ id: number }>()
}

async function authenticatedOwner() {
  const origin = 'http://localhost:5173'
  const username = `feedback${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const password = 'test-only-password-12345'
  const user = (await createAuth(env).api.createUser({
    body: {
      name: 'Feedback Test Owner',
      email: `${username}@accounts.noqueue.invalid`,
      password,
      role: 'user',
      data: { username },
    },
  })).user
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO tenant_account(organization_id,created_by,status) VALUES ('demo-org',?,'active')",
    ).bind(user.id),
    env.DB.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,'demo-org',?,'owner',datetime('now'))",
    ).bind(crypto.randomUUID(), user.id),
    env.DB.prepare(
      "INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,'demo-venue','owner')",
    ).bind(user.id),
  ])
  const response = await app.request(`${origin}/api/v1/auth/sign-in/username`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }, env)
  expect(response.status, await response.clone().text()).toBe(200)
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  return { origin, cookie }
}

it('uses the latest event as a baseline cursor without replaying historical feedback', async () => {
  const f = await queueFixture()
  const root = await addEntry(f.queueId, 1)
  const successor = await addEntry(f.queueId, 2)
  const cycle = await addCycle(f.queueId, root)
  const first = await addEvent(f.queueId, root, successor, cycle, 1)

  const baseline = await readQueueFeedback(env, f.queueId)
  expect(baseline).toEqual({ cursor: first!.id, events: [], hasMore: false })

  const second = await addEvent(f.queueId, root, successor, cycle, 2, 'customer_cancel')
  const incremental = await readQueueFeedback(env, f.queueId, baseline.cursor)
  expect(incremental).toMatchObject({ cursor: second!.id, hasMore: false })
  expect(incremental.events.map(event => event.id)).toEqual([second!.id])
  expect(incremental.events[0]?.cause).toBe('customer_cancel')
})

it('paginates feedback at 100 rows with a stable continuation cursor', async () => {
  const f = await queueFixture()
  const root = await addEntry(f.queueId, 1)
  const successor = await addEntry(f.queueId, 2)
  const cycle = await addCycle(f.queueId, root)
  await env.DB.prepare(`WITH RECURSIVE n(i) AS (
      VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<101
    ) INSERT INTO queue_staff_event(
      queue_id,entry_id,call_cycle,cycle_id,successor_entry_id,successor_call_cycle,cause,created_at
    ) SELECT ?,?,i,?,?,i,'arrival_expiry',?+i FROM n`)
    .bind(f.queueId, root, cycle, successor, f.now).run()

  const first = await readQueueFeedback(env, f.queueId, 0)
  expect(first.events).toHaveLength(100)
  expect(first.hasMore).toBe(true)
  expect(first.cursor).toBe(first.events[99]?.id)
  expect(first.events.map(event => event.id)).toEqual(
    [...first.events.map(event => event.id)].sort((a, b) => a - b),
  )

  const second = await readQueueFeedback(env, f.queueId, first.cursor)
  expect(second.events).toHaveLength(1)
  expect(second.hasMore).toBe(false)
  expect(second.cursor).toBe(second.events[0]?.id)
  expect(second.events[0]?.id).toBeGreaterThan(first.cursor)
})

it('decrypts feedback names only through the authorized queue automation endpoint', async () => {
  const f = await queueFixture()
  const root = await addEntry(f.queueId, 1, { displayName: 'María García' })
  const successor = await addEntry(f.queueId, 2, { displayName: 'Luis Pérez' })
  const cycle = await addCycle(f.queueId, root)
  await addEvent(f.queueId, root, successor, cycle)
  const endpoint = `/api/v1/staff/queues/${f.queueId}/automation?after=0`

  const anonymous = await app.request(endpoint, { headers: { Origin: 'http://localhost:5173' } }, env)
  expect(anonymous.status).not.toBe(200)
  expect(await anonymous.text()).not.toContain('María García')

  const owner = await authenticatedOwner()
  const authorized = await app.request(endpoint, {
    headers: { Origin: owner.origin, Cookie: owner.cookie },
  }, enabled)
  expect(authorized.status, await authorized.clone().text()).toBe(200)
  expect(await authorized.json()).toMatchObject({
    events: [{
      entry: { id: root, code: `code:${root}`, displayName: 'María García' },
      successor: { id: successor, code: `code:${successor}`, displayName: 'Luis Pérez' },
    }],
  })
})

it('keeps feedback independent of the 500-entry staff page and finds a priority waiter beyond it', async () => {
  const f = await queueFixture()
  const total = 501
  await env.DB.prepare(`WITH RECURSIVE n(i) AS (
      VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?
    ) INSERT INTO queue_entry(
      id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence
    ) SELECT 'feedback-bulk-entry-'||i,?,'feedback-bulk-key-'||i,'feedback-bulk-hash-'||i,
      'feedback-bulk-recovery-'||i,'feedback-bulk-code-'||i,1,'en',?,i FROM n`)
    .bind(total, f.queueId, f.now).run()
  await env.DB.prepare('UPDATE queue_entry SET priority_rank=1 WHERE id=?')
    .bind('feedback-bulk-entry-501').run()
  await env.DB.prepare(`WITH RECURSIVE n(i) AS (
      VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?
    ) INSERT INTO queue_automation_cycle(
      id,queue_id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,
      service_type,reception_service,state,created_at,updated_at
    ) SELECT 'feedback-bulk-cycle-'||i,?,'feedback-bulk-entry-'||i,0,
      'feedback-bulk-entry-'||i,0,'reception','other','active',?,? FROM n`)
    .bind(total, f.queueId, f.now, f.now).run()
  await env.DB.prepare(`INSERT INTO queue_staff_event(
      queue_id,entry_id,call_cycle,cycle_id,successor_entry_id,successor_call_cycle,cause,created_at
    ) VALUES (?, 'feedback-bulk-entry-501', 1, 'feedback-bulk-cycle-501',
      'feedback-bulk-entry-500', 1, 'staff_pass', ?)`)
    .bind(f.queueId, f.now).run()

  const feedback = await readQueueFeedback(env, f.queueId, 0)
  expect(feedback.events).toHaveLength(1)
  expect(feedback.events[0]).toMatchObject({
    entry: { id: 'feedback-bulk-entry-501' },
    successor: { id: 'feedback-bulk-entry-500' },
  })
  expect(await readAutomation(enabled, f.queueId)).toMatchObject({
    activeCycles: total,
    nextEntry: { id: 'feedback-bulk-entry-501' },
  })
})

it('rolls back a queued feedback event when a later operation in the batch fails', async () => {
  const f = await queueFixture()
  const deadline = f.now + minute
  const root = await addEntry(f.queueId, 1, {
    status: 'called', callCycle: 1, arrivalDeadlineAt: deadline,
  })
  const successor = await addEntry(f.queueId, 2)
  const cycle = await addCycle(f.queueId, root)
  await env.DB.prepare(`INSERT INTO queue_call_replacement(
    entry_id,call_cycle,queue_id,eligible,origin,service_type,service_ends_at,result,
    created_at,updated_at,automation_cycle_id,cause
  ) VALUES (?,1,?,1,'staff','reception',NULL,'pending',?,?,?,'staff')`)
    .bind(root, f.queueId, f.now, f.now, cycle).run()
  await env.DB.prepare(
    'INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,? ,\'active\',?)',
  ).bind(f.queueId, serviceWindow(f.config, 'Europe/Madrid', new Date(f.now)).windowId, f.now).run()

  const trigger = `fail_feedback_batch_${crypto.randomUUID().replaceAll('-', '')}`
  await env.DB.prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON queue_event
    WHEN NEW.kind='called' AND NEW.entry_id='${successor}'
    BEGIN SELECT RAISE(ABORT,'forced_feedback_batch_failure'); END`).run()
  try {
    await expect(expireArrivals(enabled, f.queueId, f.now + 2 * minute)).rejects.toThrow()
    expect(await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(root).first())
      .toEqual({ status: 'called' })
    expect(await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?').bind(successor).first())
      .toEqual({ status: 'waiting' })
    expect(await env.DB.prepare('SELECT current_entry_id,state FROM queue_automation_cycle WHERE id=?')
      .bind(cycle).first()).toEqual({ current_entry_id: root, state: 'active' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM queue_staff_event WHERE queue_id=?')
      .bind(f.queueId).first()).toEqual({ n: 0 })
    expect(await readQueueFeedback(env, f.queueId)).toMatchObject({ cursor: 0, events: [], hasMore: false })
  } finally {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run()
  }
})
