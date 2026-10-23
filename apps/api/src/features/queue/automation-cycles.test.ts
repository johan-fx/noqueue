import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import type { QueueCommand, ServiceInput } from '@noqueue/contracts/staff'
import { configureQueue, runQueueCommand } from '../staff/commands'
import { serviceWindow } from '../staff/availability'
import { expireArrivals, runCustomerCommand } from './customer'
import { readAutomation } from './automation'
import { recalculateQueue } from './projection'
import { readCallReplacement } from './call'
import { hash } from './crypto'
import { app } from '../../app'
import { createAuth } from '../../auth/server'

const minute = 60_000
const enabled = { ...env, QUEUE_AUTO_REPLACEMENT_ENABLED: 'true' }
afterEach(() => vi.restoreAllMocks())

type ServiceType = ServiceInput['type']
type FixtureOptions = {
  type?: ServiceType
  automatic?: boolean
  sizes?: number[]
  receptionServices?: Array<'check_in' | 'check_out' | 'other'>
  entryServices?: Array<'check_in' | 'check_out' | 'other'>
  tableSeats?: number
  actorId?: string
}

async function fixture(options: FixtureOptions = {}) {
  const type = options.type ?? 'reception'
  const now = Date.now()
  const queue = crypto.randomUUID()
  const actor = options.actorId ?? crypto.randomUUID()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const config: ServiceInput = {
    name: 'Automation cycle test',
    type,
    capacity: 99,
    averageMinutes: 4,
    graceMinutes: 3,
    cutoffMinutes: 0,
    twentyFourHours: true,
    schedules: [],
    receptionServices: options.receptionServices ?? ['other'],
    estimationMode: 'active',
    estimatorVersion: 2,
    approachMinutes: 0,
    automaticAssignmentEnabled: options.automatic ?? true,
    spaces:
      type === 'restaurant'
        ? [{
            id: 'inside',
            name: 'Inside',
            tables: 4,
            tableTypes: [{ seats: options.tableSeats ?? 6, count: 4 }],
          }]
        : [],
  }

  await env.DB.batch([
    ...(!options.actorId ? [env.DB.prepare(
      "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Test',?,datetime('now'),datetime('now'),'user')",
    ).bind(actor, `${actor}@automation.test.invalid`)] : []),
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
      "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes,open) VALUES (?,'demo-venue','Automation',?,99,4,1)",
    ).bind(queue, JSON.stringify(config)),
    env.DB.prepare(
      'INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,? ,\'active\',?)',
    ).bind(queue, serviceWindow(config, 'Europe/Madrid', new Date(now)).windowId, now),
  ])

  const ids: string[] = []
  async function add(size: number, receptionService?: 'check_in' | 'check_out' | 'other') {
    const id = crypto.randomUUID()
    ids.push(id)
    await env.DB.prepare(
      `INSERT INTO queue_entry
        (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,preferred_space_id,reception_service)
       VALUES (?,?,?,?,?,?,?,'es',?,?,?,?)`,
    ).bind(
      id,
      queue,
      id,
      id,
      await hash(id),
      id,
      size,
      Date.now(),
      ids.length,
      type === 'restaurant' ? 'inside' : null,
      receptionService ?? (type === 'reception' ? config.receptionServices[0] ?? null : null),
    ).run()
    await env.DB.prepare("INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)")
      .bind(crypto.randomUUID(), id, Date.now()).run()
    return id
  }
  for (const [index, size] of (options.sizes ?? [2, 2]).entries())
    await add(size, options.entryServices?.[index])

  await recalculateQueue(enabled, queue, now)
  const row = (index: number) => env.DB.prepare(
    `SELECT id,status,version,sequence,call_cycle,arrival_deadline_at,party_size,reception_service
       FROM queue_entry WHERE id=?`,
  ).bind(ids[index]!).first<{
    id: string; status: string; version: number; sequence: number; call_cycle: number;
    arrival_deadline_at: number | null; party_size: number; reception_service: string | null;
  }>()
  const at = (minutes: number) => {
    clock.mockReturnValue(now + minutes * minute)
    return now + minutes * minute
  }
  async function call(index: number, minutes = 0, bindings = enabled) {
    const called = await row(index)
    if (!called) throw new Error(`missing_fixture_entry_${index}`)
    const command: QueueCommand = type === 'restaurant'
      ? {
          action: 'call',
          entryId: called.id,
          version: called.version,
          seating: { mode: 'confirmed', spaceId: 'inside', seats: options.tableSeats ?? 6 },
        }
      : { action: 'assign_next', expectedEntryId: called.id, expectedVersion: called.version }
    return runQueueCommand(bindings, actor, queue, crypto.randomUUID(), command, at(minutes))
  }
  async function setAutomatic(value: boolean, minutes: number) {
    at(minutes)
    const current = await env.DB.prepare('SELECT version,open,config FROM queue WHERE id=?')
      .bind(queue).first<{ version: number; open: number; config: string }>()
    if (!current) throw new Error('missing_fixture_queue')
    const stored = JSON.parse(current.config) as ServiceInput
    await configureQueue(enabled, actor, queue, {
      ...stored,
      version: current.version,
      open: current.open === 1,
      automaticAssignmentEnabled: value,
    })
  }
  return {
    now, queue, actor, config, ids, row, at, add, call, setAutomatic,
    expire: (minutes: number, bindings = enabled) => expireArrivals(bindings, queue, at(minutes)),
    automation: (bindings = enabled) => readAutomation(bindings, queue),
    cycleFor: (entryId: string) => env.DB.prepare('SELECT * FROM queue_automation_cycle WHERE initial_entry_id=? ORDER BY created_at LIMIT 1')
      .bind(entryId).first<Record<string, unknown>>(),
    policy: (entryId: string, callCycle = 1) => readCallReplacement(env, entryId, callCycle),
    link: (entryId: string, callCycle = 1) => env.DB.prepare(
      'SELECT successor_entry_id,successor_call_cycle FROM queue_call_replacement WHERE entry_id=? AND call_cycle=?',
    ).bind(entryId, callCycle).first<{ successor_entry_id: string | null; successor_call_cycle: number | null }>(),
  }
}

async function authenticatedActor() {
  const origin = 'http://localhost:5173'
  const username = 'u' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const password = 'test-only-password-12345'
  const user = (await createAuth(env).api.createUser({
    body: {
      name: 'Automation Test Owner',
      email: `${username}@accounts.noqueue.invalid`,
      password,
      role: 'user',
      data: { username },
    },
  })).user
  const response = await app.request(`${origin}/api/v1/auth/sign-in/username`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }, env)
  expect(response.status, await response.clone().text()).toBe(200)
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  return { id: user.id, cookie, origin }
}

it('descends from a capacity above four before considering older smaller groups', async () => {
  const f = await fixture({ type: 'restaurant', sizes: [6, 4, 7, 5, 6], tableSeats: 8 })
  await f.call(0)
  for (const [minutes, selected] of [[3, 4], [6, 3], [9, 1]] as const) {
    await f.expire(minutes)
    expect(await f.row(selected)).toMatchObject({ status: 'called' })
    expect(await f.cycleFor(f.ids[0]!)).toMatchObject({
      capacity: 6, seats: 8, state: 'active', current_entry_id: f.ids[selected],
    })
  }
  expect(await f.row(2)).toMatchObject({ status: 'waiting', party_size: 7 })
})

it('keeps simultaneous check-in, check-out and other cycles within their original subtype', async () => {
  const f = await fixture({
    type: 'reception', sizes: [1, 1, 1, 1, 1, 1],
    receptionServices: ['check_in', 'check_out', 'other'],
    entryServices: ['check_in', 'check_out', 'other', 'other', 'check_out', 'check_in'],
  })
  for (const index of [0, 1, 2]) await f.call(index)
  await f.expire(3)
  for (const [initial, successor, subtype] of [[0, 5, 'check_in'], [1, 4, 'check_out'], [2, 3, 'other']] as const) {
    expect(await f.row(initial)).toMatchObject({ status: 'expired' })
    expect(await f.row(successor)).toMatchObject({ status: 'called', reception_service: subtype })
    expect(await f.cycleFor(f.ids[initial]!)).toMatchObject({
      reception_service: subtype, state: 'active', current_entry_id: f.ids[successor],
    })
  }
  expect(await f.automation()).toMatchObject({ activeCycles: 3 })
})

it('requires both the service opt-in and the global kill switch; enabling later does not arm an old call', async () => {
  const optOut = await fixture({ automatic: false })
  await optOut.call(0)
  expect(await optOut.row(0)).toMatchObject({ status: 'called' })
  expect(await optOut.policy(optOut.ids[0]!)).toMatchObject({ eligible: 0, automation_cycle_id: null })
  expect(await optOut.automation()).toMatchObject({ configured: false, effective: false, activeCycles: 0 })

  const killSwitch = await fixture({ automatic: true })
  const disabledBindings = { ...enabled, QUEUE_AUTO_REPLACEMENT_ENABLED: 'false' }
  await killSwitch.call(0, 0, disabledBindings)
  expect(await killSwitch.policy(killSwitch.ids[0]!)).toMatchObject({ eligible: 0, automation_cycle_id: null })
  expect(await killSwitch.automation(disabledBindings)).toMatchObject({ configured: true, effective: false, activeCycles: 0 })
  await killSwitch.expire(3, enabled)
  expect(await killSwitch.row(1)).toMatchObject({ status: 'waiting' })
  expect(await killSwitch.policy(killSwitch.ids[0]!)).toMatchObject({ result: 'disabled' })
  await killSwitch.call(1, 4, enabled)
  expect(await killSwitch.automation()).toMatchObject({ configured: true, effective: true, activeCycles: 1 })
})

it('stops an active cycle on service opt-out without cancelling the called turn or resurrecting it on opt-in', async () => {
  const f = await fixture({ automatic: true })
  await f.call(0)
  const deadline = (await f.row(0))!.arrival_deadline_at
  expect(await f.automation()).toMatchObject({ configured: true, effective: true, activeCycles: 1 })

  // Legacy update clients omit this newer setting; omission must preserve opt-in.
  const stored = await env.DB.prepare('SELECT version,open,config FROM queue WHERE id=?')
    .bind(f.queue).first<{ version: number; open: number; config: string }>()
  const legacyConfig = JSON.parse(stored!.config) as ServiceInput
  delete legacyConfig.automaticAssignmentEnabled
  await configureQueue(enabled, f.actor, f.queue, {
    ...legacyConfig,
    version: stored!.version,
    open: stored!.open === 1,
  })
  expect(JSON.parse((await env.DB.prepare('SELECT config FROM queue WHERE id=?').bind(f.queue).first<{config:string}>())!.config))
    .toMatchObject({ automaticAssignmentEnabled: true })
  expect(await f.automation()).toMatchObject({ activeCycles: 1 })

  await f.setAutomatic(false, 1)
  expect(await f.row(0)).toMatchObject({ status: 'called', arrival_deadline_at: deadline })
  expect(await f.cycleFor(f.ids[0]!)).toMatchObject({ state: 'stopped', reason: 'disabled' })
  expect(await f.automation()).toMatchObject({ configured: false, effective: false, activeCycles: 0 })

  await f.setAutomatic(true, 2)
  expect(await f.automation()).toMatchObject({ configured: true, effective: true, activeCycles: 0 })
  await f.expire(3)
  expect(await f.row(0)).toMatchObject({ status: 'expired' })
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
  expect(await f.policy(f.ids[0]!)).toMatchObject({ result: 'disabled' })

  await f.call(1, 4)
  expect(await f.automation()).toMatchObject({ activeCycles: 1 })
})

it('keeps restaurant root capacity at four on a six-seat table while selecting 4→2→4 and never five', async () => {
  const f = await fixture({ type: 'restaurant', sizes: [4, 2], tableSeats: 6 })
  await f.call(0)
  const cycle = await f.cycleFor(f.ids[0]!)
  expect(cycle).toMatchObject({ capacity: 4, seats: 6, initial_entry_id: f.ids[0]!, current_entry_id: f.ids[0]! })

  await f.expire(3)
  expect(await f.row(1)).toMatchObject({ status: 'called', party_size: 2 })
  expect(await env.DB.prepare('SELECT capacity,current_entry_id FROM queue_automation_cycle WHERE id=?')
    .bind(cycle!.id).first()).toEqual({ capacity: 4, current_entry_id: f.ids[1] })

  const laterFour = await f.add(4)
  const tooLarge = await f.add(5)
  await f.expire(6)
  expect(await env.DB.prepare('SELECT status,party_size FROM queue_entry WHERE id=?').bind(laterFour).first())
    .toEqual({ status: 'called', party_size: 4 })
  expect(await env.DB.prepare('SELECT status,party_size FROM queue_entry WHERE id=?').bind(tooLarge).first())
    .toEqual({ status: 'waiting', party_size: 5 })
  expect(await env.DB.prepare('SELECT capacity,current_entry_id FROM queue_automation_cycle WHERE id=?')
    .bind(cycle!.id).first()).toEqual({ capacity: 4, current_entry_id: laterFour })
})

it('selects a reception successor from the same subtype, not an older different subtype', async () => {
  const f = await fixture({
    type: 'reception',
    receptionServices: ['check_in', 'check_out'],
    entryServices: ['check_in', 'check_out', 'check_in'],
    sizes: [2, 2, 2],
  })
  await f.call(0)
  await f.expire(3)
  expect(await f.row(1)).toMatchObject({ status: 'waiting', reception_service: 'check_out' })
  expect(await f.row(2)).toMatchObject({ status: 'called', reception_service: 'check_in' })
  expect(await env.DB.prepare('SELECT current_entry_id,reception_service FROM queue_automation_cycle WHERE initial_entry_id=?')
    .bind(f.ids[0]!).first()).toEqual({ current_entry_id: f.ids[2], reception_service: 'check_in' })

  const removedSubtype = await fixture({
    type: 'reception',
    receptionServices: ['check_in', 'check_out'],
    entryServices: ['check_in', 'check_in'],
    sizes: [2, 2],
  })
  await removedSubtype.call(0)
  const withoutCycleSubtype: ServiceInput = { ...removedSubtype.config, receptionServices: ['check_out'] }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify(withoutCycleSubtype), removedSubtype.queue).run()
  await removedSubtype.expire(3)
  expect(await removedSubtype.row(0)).toMatchObject({ status: 'expired' })
  expect(await removedSubtype.row(1)).toMatchObject({ status: 'waiting' })
  expect(await removedSubtype.policy(removedSubtype.ids[0]!)).toMatchObject({ result: 'context_changed' })
  expect(await removedSubtype.cycleFor(removedSubtype.ids[0]!)).toMatchObject({ state: 'stopped', reason: 'context_changed' })
})

it('stops on staff cancellation but immediately replaces a called customer cancellation in the same cycle', async () => {
  const staff = await fixture({ type: 'reception' })
  await staff.call(0)
  await runQueueCommand(enabled, staff.actor, staff.queue, crypto.randomUUID(),
    { action: 'cancel', entryId: staff.ids[0]!, version: 1 }, staff.at(1))
  expect(await staff.row(0)).toMatchObject({ status: 'cancelled' })
  expect(await staff.row(1)).toMatchObject({ status: 'waiting' })
  expect(await staff.cycleFor(staff.ids[0]!)).toMatchObject({ state: 'stopped', reason: 'cancelled' })
  expect(await staff.automation()).toMatchObject({ activeCycles: 0 })
  await staff.expire(5)
  expect(await staff.row(1)).toMatchObject({ status: 'waiting' })

  const customer = await fixture({ type: 'reception' })
  await customer.call(0)
  await runCustomerCommand(enabled, customer.queue, customer.ids[0]!, crypto.randomUUID(),
    { action: 'cancel', version: 1 }, customer.at(1))
  expect(await customer.row(0)).toMatchObject({ status: 'cancelled' })
  expect(await customer.row(1)).toMatchObject({ status: 'called', call_cycle: 1 })
  const rootAttempt = await customer.policy(customer.ids[0]!)
  const successorAttempt = await customer.policy(customer.ids[1]!)
  expect(rootAttempt).toMatchObject({ result: 'cancelled' })
  expect(await customer.link(customer.ids[0]!)).toMatchObject({ successor_entry_id: customer.ids[1], successor_call_cycle: 1 })
  expect(successorAttempt?.automation_cycle_id).toBe(rootAttempt?.automation_cycle_id)
  expect(await customer.cycleFor(customer.ids[0]!)).toMatchObject({
    state: 'active', current_entry_id: customer.ids[1], current_call_cycle: 1,
  })
})

it('yield never hands a cycle to itself and exchanges positions with the later successor', async () => {
  const f = await fixture({ type: 'restaurant', sizes: [4, 4], tableSeats: 6 })
  await f.call(0)
  await runCustomerCommand(enabled, f.queue, f.ids[0]!, crypto.randomUUID(),
    { action: 'yield', version: 1 }, f.at(1))

  expect(await f.row(0)).toMatchObject({ status: 'waiting', sequence: 2, call_cycle: 2 })
  expect(await f.row(1)).toMatchObject({ status: 'called', sequence: 1, call_cycle: 1 })
  const yielded = await f.policy(f.ids[0]!)
  expect(yielded).toMatchObject({ result: 'yielded' })
  expect(await f.link(f.ids[0]!)).toMatchObject({ successor_entry_id: f.ids[1], successor_call_cycle: 1 })
  expect(await f.policy(f.ids[1]!)).toMatchObject({ automation_cycle_id: yielded?.automation_cycle_id })
  expect(await f.cycleFor(f.ids[0]!)).toMatchObject({ state: 'active', current_entry_id: f.ids[1] })
})

it('preserves the yielding entry original sequence when the successor was already earlier', async () => {
  const f = await fixture({ type: 'restaurant', sizes: [4, 4], tableSeats: 6 })
  // Assign the later entry manually while the compatible successor is earlier in queue order.
  await env.DB.batch([
    env.DB.prepare('UPDATE queue_entry SET sequence=3 WHERE id=?').bind(f.ids[0]!),
    env.DB.prepare('UPDATE queue_entry SET sequence=1 WHERE id=?').bind(f.ids[1]!),
    env.DB.prepare('UPDATE queue_entry SET sequence=2 WHERE id=?').bind(f.ids[0]!),
  ])
  await f.call(0)
  const originalSequence = (await f.row(0))!.sequence
  expect((await f.row(1))!.sequence).toBeLessThan(originalSequence)

  await runCustomerCommand(enabled, f.queue, f.ids[0]!, crypto.randomUUID(),
    { action: 'yield', version: 1 }, f.at(1))

  expect(await f.row(0)).toMatchObject({ status: 'waiting', sequence: originalSequence, call_cycle: 2 })
  expect(await f.row(1)).toMatchObject({ status: 'called', sequence: 1, call_cycle: 1 })
})

it('does not create or transfer an automation cycle on customer cancel/yield when service opt-in is off', async () => {
  const cancelled = await fixture({ type: 'reception', automatic: false })
  await cancelled.call(0)
  await runCustomerCommand(enabled, cancelled.queue, cancelled.ids[0]!, crypto.randomUUID(),
    { action: 'cancel', version: 1 }, cancelled.at(1))
  expect(await cancelled.row(1)).toMatchObject({ status: 'waiting' })
  expect(await cancelled.policy(cancelled.ids[0]!)).toMatchObject({ eligible: 0, automation_cycle_id: null })
  expect(await cancelled.automation()).toMatchObject({ activeCycles: 0 })

  const yielded = await fixture({ type: 'restaurant', automatic: false, sizes: [4, 4], tableSeats: 6 })
  await yielded.call(0)
  await runCustomerCommand(enabled, yielded.queue, yielded.ids[0]!, crypto.randomUUID(),
    { action: 'yield', version: 1 }, yielded.at(1))
  expect(await yielded.row(0)).toMatchObject({ status: 'waiting', call_cycle: 2 })
  expect(await yielded.row(1)).toMatchObject({ status: 'waiting', call_cycle: 0 })
  expect(await yielded.automation()).toMatchObject({ activeCycles: 0 })
  expect(await yielded.policy(yielded.ids[0]!)).toMatchObject({ eligible: 0, automation_cycle_id: null })
})

it('clears an expired retained end and starts a fresh cycle when manually called in a reopened 24-hour window', async () => {
  const f = await fixture({ type: 'restaurant', automatic: true, sizes: [4], tableSeats: 6 })
  await env.DB.prepare("UPDATE queue_entry SET manual_only=1,service_window_id='old-window',service_ends_at=? WHERE id=?")
    .bind(f.now - 1, f.ids[0]!).run()

  await f.call(0)

  expect(await f.row(0)).toMatchObject({ status: 'called', party_size: 4 })
  const retained = await env.DB.prepare('SELECT manual_only,service_window_id,service_ends_at FROM queue_entry WHERE id=?')
    .bind(f.ids[0]!).first()
  expect(retained).toMatchObject({ manual_only: 0, service_window_id: expect.stringContaining('continuous:'), service_ends_at: null })
  expect(await f.policy(f.ids[0]!)).toMatchObject({ eligible: 1, service_ends_at: null })
  expect(await f.cycleFor(f.ids[0]!)).toMatchObject({ state: 'active', service_ends_at: null, capacity: 4 })
})

it('allows an out-of-hours manual call but does not start an automatic cycle', async () => {
  const f = await fixture({ type: 'reception', automatic: true })
  const today = serviceWindow(f.config, 'Europe/Madrid', new Date(f.now)).day
  const closedConfig: ServiceInput = {
    ...f.config,
    twentyFourHours: false,
    schedules: [{ day: (today + 1) % 7, from: '00:00', to: '23:59' }],
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE queue SET config=? WHERE id=?').bind(JSON.stringify(closedConfig), f.queue),
    env.DB.prepare("UPDATE queue_entry SET service_window_id='prior-window',service_ends_at=NULL WHERE queue_id=?").bind(f.queue),
  ])

  await f.call(0)

  expect(await f.row(0)).toMatchObject({ status: 'called' })
  expect(await f.policy(f.ids[0]!)).toMatchObject({ eligible: 0, automation_cycle_id: null })
  expect(await f.automation()).toMatchObject({ configured: true, effective: true, activeCycles: 0 })
})

it('keeps simultaneous cycles independent and reads their full active count', async () => {
  const f = await fixture({ type: 'restaurant', sizes: [4, 2, 4], tableSeats: 6 })
  await f.call(0)
  await f.call(1, 0)
  expect(await f.automation()).toMatchObject({ configured: true, effective: true, activeCycles: 2 })
  expect(await env.DB.prepare('SELECT capacity FROM queue_automation_cycle WHERE queue_id=? AND state=\'active\' ORDER BY capacity')
    .bind(f.queue).all()).toMatchObject({ results: [{ capacity: 2 }, { capacity: 4 }] })

  await runQueueCommand(enabled, f.actor, f.queue, crypto.randomUUID(),
    { action: 'complete', entryId: f.ids[0]!, version: 1 }, f.at(1))
  expect(await f.automation()).toMatchObject({ activeCycles: 1 })
  expect(await f.cycleFor(f.ids[0]!)).toMatchObject({ state: 'stopped', reason: 'arrived' })
  expect(await f.cycleFor(f.ids[1]!)).toMatchObject({ state: 'active', current_entry_id: f.ids[1] })
})

it('reports more than 500 active cycles through the staff automation endpoint', async () => {
  const { runInDurableObject } = await import('cloudflare:test')
  const actor = await authenticatedActor()
  const f = await fixture({ type: 'reception', sizes: [], actorId: actor.id })
  const total = 501
  await env.DB.prepare(`WITH RECURSIVE n(i) AS (
      VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?
    ) INSERT INTO queue_entry
      (id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence)
    SELECT 'auto-count-entry-'||i,?,'auto-count-key-'||i,'test-hash','auto-count-recovery-'||i,
      'auto-count-code-'||i,1,'es',?,i FROM n`)
    .bind(total, f.queue, f.now).run()
  await env.DB.prepare(`WITH RECURSIVE n(i) AS (
      VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?
    ) INSERT INTO queue_automation_cycle
      (id,queue_id,initial_entry_id,initial_call_cycle,current_entry_id,current_call_cycle,service_type,state,created_at,updated_at)
    SELECT 'auto-count-cycle-'||i,?,'auto-count-entry-'||i,1,'auto-count-entry-'||i,1,
      'reception','active',?,? FROM n`)
    .bind(total, f.queue, f.now, f.now).run()
  const coordinator = env.QUEUE_COORDINATOR.getByName(f.queue)
  // Request bindings do not override an already-created Durable Object's env.
  // Enable the test-only global gate on this isolated coordinator directly.
  await runInDurableObject(coordinator, (instance) => {
    ;(instance as unknown as { env: CloudflareBindings }).env.QUEUE_AUTO_REPLACEMENT_ENABLED = 'true'
  })
  try {
    const response = await app.request(`${actor.origin}/api/v1/staff/queues/${f.queue}/automation`, {
      headers: { Origin: actor.origin, Cookie: actor.cookie },
    }, enabled)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ configured: true, effective: true, activeCycles: total })
  } finally {
    await runInDurableObject(coordinator, (instance) => {
      ;(instance as unknown as { env: CloudflareBindings }).env.QUEUE_AUTO_REPLACEMENT_ENABLED = 'false'
    })
  }
})

it('exposes actual cycle attempts, waiting age and retained action restrictions', async () => {
  const { runInDurableObject } = await import('cloudflare:test')
  const actor = await authenticatedActor()
  const f = await fixture({ type: 'restaurant', sizes: [4, 2, 1], actorId: actor.id })
  // Several earlier personal calls must not make a newly started cycle Attempt 8.
  await env.DB.prepare('UPDATE queue_entry SET call_cycle=7 WHERE id=?').bind(f.ids[0]).run()
  await env.DB.prepare('UPDATE queue_entry SET priority_rank=1 WHERE id=?').bind(f.ids[1]).run()
  await env.DB.prepare('UPDATE queue_entry SET manual_only=1 WHERE id=?').bind(f.ids[2]).run()
  await f.call(0)
  const coordinator = env.QUEUE_COORDINATOR.getByName(f.queue)
  await runInDurableObject(coordinator, instance => {
    ;(instance as unknown as { env: CloudflareBindings }).env.QUEUE_AUTO_REPLACEMENT_ENABLED = 'true'
  })
  const headers = { Origin: actor.origin, Cookie: actor.cookie }
  const entries = async () => {
    const response = await app.request(`${actor.origin}/api/v1/staff/queues/${f.queue}/entries`, { headers }, enabled)
    expect(response.status, await response.clone().text()).toBe(200)
    return response.json() as Promise<import('@noqueue/contracts/staff').StaffEntry[]>
  }
  try {
    let rows = await entries()
    expect(rows.find(row => row.id === f.ids[0])?.automationCycle?.attempt).toBe(1)
    expect(rows.find(row => row.id === f.ids[1])).toMatchObject({ priorityRank: 1, waitingSince: f.now })
    expect(rows.find(row => row.id === f.ids[2])?.allowedActions).toEqual(['call', 'cancel'])
    await f.expire(4)
    rows = await entries()
    expect(rows.find(row => row.id === f.ids[1])).toMatchObject({ priorityRank: null, automationCycle: { attempt: 2 } })
    const invalid = await app.request(`${actor.origin}/api/v1/staff/queues/${f.queue}/automation?after=-1`, { headers }, enabled)
    expect(invalid.status).toBe(400)
    const incremental = await app.request(`${actor.origin}/api/v1/staff/queues/${f.queue}/automation?after=0`, { headers }, enabled)
    expect(await incremental.json()).toMatchObject({ events: [{ cause: 'arrival_expiry', entry: { id: f.ids[0] }, successor: { id: f.ids[1] } }] })
  } finally {
    await runInDurableObject(coordinator, instance => {
      ;(instance as unknown as { env: CloudflareBindings }).env.QUEUE_AUTO_REPLACEMENT_ENABLED = 'false'
    })
  }
})
