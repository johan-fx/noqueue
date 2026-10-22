import { env } from 'cloudflare:workers'
import { afterEach, expect, it, vi } from 'vitest'
import type { EntryCommand, ServiceInput } from '@noqueue/contracts/staff'
import { runQueueCommand } from '../staff/commands'
import { serviceWindow } from '../staff/availability'
import { expireArrivals, runCustomerCommand } from './customer'
import { loadQueueState, recalculateQueue, maintainQueue } from './projection'
import { readReplacementDecisions } from './replacement-decisions'
import { readCallReplacement } from './call'
import { hash } from './crypto'
import { publishNotice } from './notices'
import { parsePushSnapshot } from '../mobile/push/lifecycle'
import { currentPushSnapshot } from '../mobile/push/validity'

const minute = 60_000
const enabled = { ...env, QUEUE_AUTO_REPLACEMENT_ENABLED: 'true' }
const mobileEnabled = { ...enabled, MOBILE_PUSH_ENABLED: 'true', WHATSAPP_ENABLED: 'false' }
afterEach(() => vi.restoreAllMocks())

// Each turn belongs to its own installation, as required by mobile's single-turn invariant.
async function attachMobileTurns(ids: string[], registered = true) {
  for (const id of ids) {
    const installation = await hash(`replacement-test:${id}`)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM consent WHERE entry_id=?').bind(id),
      env.DB.prepare('INSERT INTO mobile_entry_installation VALUES (?,?,?)').bind(id, installation, Date.now()),
      env.DB.prepare(`INSERT INTO mobile_push_registration
        (installation_hash,provider,token_hash,token_cipher,locale,enabled,updated_at,platform)
        VALUES (?,'fcm',?,'unused-test-token','es',?,?,'android')`)
        .bind(installation, installation, Number(registered), Date.now()),
    ])
  }
}
async function mobileNotices(entryId: string) {
  return (await env.DB.prepare(`SELECT entry_id,kind,status,call_cycle,revision,attempts,payload_snapshot
    FROM mobile_push_outbox WHERE entry_id=? ORDER BY rowid`).bind(entryId).all<{
    entry_id: string; kind: string; status: string; call_cycle: number; revision: number;
    attempts: number; payload_snapshot: string;
  }>()).results
}

it.each(['reception', 'pool', 'restaurant'] as const)(
  'preserves independent mobile call and expiry notices across automatic %s replacement',
  async type => {
    const f = await fixture(type, 2)
    await attachMobileTurns(f.ids)
    await f.call(0, 0, {}, mobileEnabled)
    expect(await mobileNotices(f.ids[0]!)).toMatchObject([{ kind: 'called', status: 'pending', call_cycle: 1 }])
    await f.expire(3, mobileEnabled)
    await f.expire(3, mobileEnabled)
    expect(await mobileNotices(f.ids[0]!)).toMatchObject([
      { kind: 'called', status: 'discarded', call_cycle: 1 },
      { kind: 'expired', status: 'pending', call_cycle: 1 },
    ])
    const successor = await mobileNotices(f.ids[1]!)
    expect(successor).toHaveLength(1)
    expect(successor[0]).toMatchObject({ kind: 'called', status: 'pending', call_cycle: 1 })
    const snapshot = parsePushSnapshot(successor[0]!.payload_snapshot)
    expect(snapshot.arrivalDeadlineAt).toBe(f.now + 6 * minute)
    expect(await currentPushSnapshot(mobileEnabled, successor[0]!, snapshot, f.at(3))).not.toBeNull()
    expect(await env.DB.prepare('SELECT 1 FROM notification_outbox WHERE entry_id IN (?,?)')
      .bind(...f.ids).first()).toBeNull()
  },
)

it.each(['unregistered', 'push_disabled', 'replacement_disabled'] as const)(
  'keeps mobile and replacement feature gates independent when %s',
  async mode => {
    const f = await fixture('reception', 2)
    await attachMobileTurns(f.ids, mode !== 'unregistered')
    const bindings = { ...mobileEnabled,
      MOBILE_PUSH_ENABLED: mode === 'push_disabled' ? 'false' : 'true',
      QUEUE_AUTO_REPLACEMENT_ENABLED: mode === 'replacement_disabled' ? 'false' : 'true',
    }
    await f.call(0, 0, {}, bindings)
    await f.expire(3, bindings)
    expect(await f.row(0)).toMatchObject({ status: 'expired' })
    expect(await f.row(1)).toMatchObject({ status: mode === 'replacement_disabled' ? 'waiting' : 'called' })
    if (mode === 'replacement_disabled') {
      // The waiting turn may still receive ordinary ETA corrections, never a call.
      expect((await mobileNotices(f.ids[1]!)).filter(n => n.kind === 'called')).toEqual([])
      expect(await mobileNotices(f.ids[0]!)).toMatchObject([
        { kind: 'called', status: 'discarded' }, { kind: 'expired', status: 'pending' },
      ])
    } else {
      expect(await mobileNotices(f.ids[0]!)).toEqual([])
      expect(await mobileNotices(f.ids[1]!)).toEqual([])
    }
  },
)

it('preserves mobile push when a customer yields to a replacement', async () => {
  const f = await fixture('restaurant', 2)
  await attachMobileTurns(f.ids)
  await f.call(0, 0, {}, mobileEnabled)
  await runCustomerCommand(mobileEnabled, f.queue, f.ids[0]!, crypto.randomUUID(),
    { action: 'yield', version: 1 }, f.at(1))
  expect(await mobileNotices(f.ids[0]!)).toMatchObject([{ kind: 'called', status: 'discarded' }])
  expect(await mobileNotices(f.ids[1]!)).toMatchObject([{ kind: 'called', status: 'pending', call_cycle: 1 }])
  expect(await f.policy(1)).toMatchObject({ eligible: 1 })
})

it('commits a manual replacement and mobile push together, rolls both back and deduplicates replay', async () => {
  const f = await decisionFixture()
  await attachMobileTurns(f.ids)
  const d = (await readReplacementDecisions(mobileEnabled, f.queue, f.at(4)))[0]!
  const candidate = d.candidates[0]!
  const command = { action: 'resolve_replacement' as const, decisionId: d.id, decisionVersion: d.version,
    entryId: candidate.id, version: candidate.version }
  const key = crypto.randomUUID()
  await env.DB.exec("CREATE TRIGGER fail_mobile_decision BEFORE UPDATE ON queue_replacement_decision WHEN NEW.status='assigned' BEGIN SELECT RAISE(ABORT,'test rollback'); END;")
  try {
    await expect(runQueueCommand(mobileEnabled, f.actor, f.queue, key, command, f.at(4))).rejects.toThrow()
    expect(await mobileNotices(candidate.id)).toEqual([])
    expect(await f.row(2)).toMatchObject({ status: 'waiting', call_cycle: 0 })
  } finally {
    await env.DB.exec('DROP TRIGGER fail_mobile_decision')
  }
  await runQueueCommand(mobileEnabled, f.actor, f.queue, key, command, f.at(4))
  await runQueueCommand(mobileEnabled, f.actor, f.queue, key, command, f.at(4))
  expect(await mobileNotices(candidate.id)).toMatchObject([{ kind: 'called', status: 'pending', call_cycle: 1 }])
  expect(await mobileNotices(candidate.id)).toHaveLength(1)
})

async function fixture(type: ServiceInput['type'] = 'reception', count = 5) {
  const now = Date.now(),
    queue = crypto.randomUUID(),
    actor = crypto.randomUUID()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const config: ServiceInput = {
    name: 'Replacement test',
    type,
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
    spaces:
      type === 'restaurant'
        ? [
            {
              id: 'inside',
              name: 'Inside',
              tables: 2,
              tableTypes: [
                { seats: 4, count: 1 },
                { seats: 8, count: 1 },
              ],
            },
            {
              id: 'outside',
              name: 'Outside',
              tables: 1,
              tableTypes: [{ seats: 4, count: 1 }],
            },
          ]
        : [],
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,'Test',?,datetime('now'),datetime('now'),'user')",
    ).bind(actor, `${actor}@test.invalid`),
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
      "INSERT INTO queue(id,venue_id,name,config,capacity,average_minutes,open) VALUES (?,'demo-venue','Replacement',?,99,4,1)",
    ).bind(queue, JSON.stringify(config)),
    env.DB.prepare(
      "INSERT INTO queue_admission(queue_id,window_id,override_state,activated_at) VALUES (?,?,'active',?)",
    ).bind(
      queue,
      serviceWindow(config, 'Europe/Madrid', new Date(now)).windowId,
      now,
    ),
  ])
  const ids: string[] = []
  async function add() {
    const id = crypto.randomUUID()
    ids.push(id)
    await env.DB.prepare(
      `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,service_window_id)
      VALUES (?,?,?,?,?,?,2,'es',?,?,'continuous')`,
    )
      .bind(id, queue, id, id, await hash(id), id, Date.now(), ids.length)
      .run()
    await env.DB.prepare(
      "INSERT INTO consent VALUES (?,?,'demo-org','queue_updates','test-only',?,NULL)",
    )
      .bind(crypto.randomUUID(), id, Date.now())
      .run()
    return id
  }
  for (let i = 0; i < count; i++) await add()
  await recalculateQueue(enabled, queue, now)
  const row = (i: number) =>
    env.DB.prepare(
      'SELECT status,version,sequence,call_cycle,arrival_deadline_at FROM queue_entry WHERE id=?',
    )
      .bind(ids[i]!)
      .first<{
        status: string
        version: number
        sequence: number
        call_cycle: number
        arrival_deadline_at: number | null
      }>()
  const at = (minutes: number) => {
    clock.mockReturnValue(now + minutes * minute)
    return Date.now()
  }
  async function call(
    i: number,
    minutes = 0,
    override: Partial<EntryCommand> = {},
    bindings = enabled,
    key = crypto.randomUUID(),
  ) {
    at(minutes)
    const version = (await row(i))!.version
    return runQueueCommand(
      bindings,
      actor,
      queue,
      key,
      type === 'restaurant'
        ? {
            action: 'call',
            entryId: ids[i]!,
            version,
            seating: { mode: 'confirmed', spaceId: 'inside', seats: 4 },
            ...override,
          }
        : {
            action: 'assign_next',
            expectedEntryId: ids[i]!,
            expectedVersion: version,
          },
      Date.now(),
    )
  }
  return {
    now,
    queue,
    actor,
    config,
    ids,
    row,
    at,
    add,
    call,
    expire: (minutes: number, bindings = enabled) =>
      expireArrivals(bindings, queue, at(minutes)),
    policy: async (i: number) =>
      readCallReplacement(env, ids[i]!, (await row(i))!.call_cycle),
  }
}

it.each(['reception', 'pool'] as const)(
  'replaces absent %s calls repeatedly, preserving order, and stops at arrival',
  async (type) => {
    const f = await fixture(type)
    await f.call(0)
    await f.expire(3)
    expect(await f.row(0)).toMatchObject({ status: 'expired', version: 2 })
    expect(await f.row(1)).toMatchObject({
      status: 'called',
      sequence: 2,
      arrival_deadline_at: f.now + 6 * minute,
    })
    await f.expire(6)
    expect(await f.row(2)).toMatchObject({
      status: 'called',
      sequence: 3,
      arrival_deadline_at: f.now + 9 * minute,
    })
    await runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      { action: 'complete', entryId: f.ids[2]!, version: 1 },
      f.at(7),
    )
    await f.expire(10)
    expect(await f.policy(2)).toMatchObject({ result: 'arrived' })
    expect(await f.row(3)).toMatchObject({ status: 'waiting', sequence: 4 })
    const links = await env.DB.prepare(
      "SELECT successor_entry_id FROM queue_call_replacement WHERE queue_id=? AND result='replaced' ORDER BY created_at,rowid",
    )
      .bind(f.queue)
      .all()
    expect(links.results.map((r) => r.successor_entry_id)).toEqual([
      f.ids[1],
      f.ids[2],
    ])
  },
)

it('selects equal-size restaurant parties, retaining the original capacity', async () => {
  const f = await fixture('restaurant', 6)
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE queue_entry SET party_size=6,preferred_space_id='inside' WHERE id=?",
    ).bind(f.ids[0]!),
    env.DB.prepare(
      "UPDATE queue_entry SET preferred_space_id='outside' WHERE id=?",
    ).bind(f.ids[1]!),
    env.DB.prepare(
      "UPDATE queue_entry SET party_size=4,preferred_space_id='inside' WHERE id=?",
    ).bind(f.ids[4]!),
  ])
  // A deliberate human selection later in the list must not hide older compatibles.
  await f.call(3)
  await f.expire(3)
  expect(await f.row(2)).toMatchObject({ status: 'called', sequence: 3 })
  expect(await f.row(0)).toMatchObject({ status: 'waiting', sequence: 1 })
  expect(await f.row(1)).toMatchObject({ status: 'waiting', sequence: 2 })
  await f.expire(6)
  expect(await f.row(4)).toMatchObject({ status: 'waiting', sequence: 5 })
  expect(await f.row(5)).toMatchObject({ status: 'called', sequence: 6 })
  const observations = await env.DB.prepare(
    'SELECT seats,space_id,source,ratio FROM queue_assignment_observation WHERE entry_id IN (?,?) ORDER BY assigned_at',
  )
    .bind(f.ids[2]!, f.ids[5]!)
    .all()
  expect(observations.results).toEqual([
    { seats: 4, space_id: 'inside', source: 'handoff', ratio: null },
    { seats: 4, space_id: 'inside', source: 'handoff', ratio: null },
  ])
})

it('does not infer restaurant capacity and stops if the confirmed catalogue context disappears', async () => {
  const f = await fixture('restaurant')
  await f.call(0, 0, { seating: undefined })
  await f.expire(3)
  expect(await f.policy(0)).toMatchObject({ result: 'missing_context' })
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
  await f.call(1, 4)
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify({ ...f.config, spaces: [] }), f.queue)
    .run()
  await f.expire(7)
  expect(await f.policy(1)).toMatchObject({ result: 'context_changed' })
  expect(await f.row(2)).toMatchObject({ status: 'waiting' })
})

it('ends without a candidate; later joins cannot consume an old authorization', async () => {
  const f = await fixture('reception', 1)
  await f.call(0)
  await f.expire(3)
  expect(await f.policy(0)).toMatchObject({ result: 'no_candidate' })
  await f.add()
  await f.expire(4)
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
})

it('never arms old calls retroactively, and the kill switch preserves expiry', async () => {
  const f = await fixture()
  const disabled = { ...enabled, QUEUE_AUTO_REPLACEMENT_ENABLED: 'false' }
  await f.call(0, 0, {}, disabled)
  await f.expire(3)
  expect(await f.policy(0)).toMatchObject({ eligible: 0, result: 'disabled' })
  await f.call(1, 4)
  await f.expire(7, disabled)
  expect(await f.policy(1)).toMatchObject({ result: 'disabled' })
  await f.call(2, 8)
  await env.DB.prepare('DELETE FROM queue_call_replacement WHERE entry_id=?')
    .bind(f.ids[2]!)
    .run()
  await f.expire(11)
  expect(await f.policy(2)).toMatchObject({ result: 'legacy' })
  expect(await f.row(3)).toMatchObject({ status: 'waiting' })
})

it('stops at the original service end but not when admissions are closed', async () => {
  const f = await fixture()
  await env.DB.prepare('UPDATE queue_entry SET service_ends_at=? WHERE id=?')
    .bind(f.now + 2 * minute, f.ids[0]!)
    .run()
  await f.call(0)
  await f.expire(3)
  expect(await f.policy(0)).toMatchObject({ result: 'service_ended' })
  await f.call(1, 4)
  await env.DB.prepare('UPDATE queue SET open=0 WHERE id=?').bind(f.queue).run()
  await f.expire(7)
  expect(await f.row(2)).toMatchObject({ status: 'called' })
})

it('assigns distinct successors for simultaneous deadlines and replays expiry without duplicates', async () => {
  const f = await fixture()
  await f.call(0)
  await f.call(1)
  await f.expire(3)
  await f.expire(3)
  const rows = await env.DB.prepare(
    "SELECT result,successor_entry_id FROM queue_call_replacement WHERE queue_id=? AND result='replaced'",
  )
    .bind(f.queue)
    .all()
  expect(new Set(rows.results.map((r) => r.successor_entry_id))).toEqual(
    new Set([f.ids[2], f.ids[3]]),
  )
  expect(await f.row(4)).toMatchObject({ status: 'waiting' })
  const calls = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM queue_event WHERE kind='called' AND entry_id IN (?,?)",
  )
    .bind(f.ids[2]!, f.ids[3]!)
    .first()
  expect(calls?.n).toBe(2)
})

it('starts a full deadline at actual execution, not at an overdue predecessor deadline', async () => {
  const f = await fixture()
  await f.call(0)
  await f.expire(20)
  expect(await f.row(1)).toMatchObject({
    status: 'called',
    arrival_deadline_at: f.now + 23 * minute,
  })
  expect(await f.row(2)).toMatchObject({ status: 'waiting' })
})

it('keeps the human learning anchor and ratios independent from replacements', async () => {
  const f = await fixture('reception', 6)
  await f.call(0)
  const initial = (await loadQueueState(enabled, f.queue, f.now)).adaptive!
  await f.expire(3)
  await f.expire(6)
  const after = (await loadQueueState(enabled, f.queue, f.at(6))).adaptive!
  expect(after.state.last_assignment_at).toBe(f.now)
  expect(after.factors).toEqual(initial.factors)
  // Arrival stops this chain, leaving demand active for the next human assignment.
  await runQueueCommand(
    enabled,
    f.actor,
    f.queue,
    crypto.randomUUID(),
    { action: 'complete', entryId: f.ids[2]!, version: 1 },
    f.at(7),
  )
  await f.call(3, 10)
  const rows = await env.DB.prepare(
    'SELECT source,interval_ms,ratio FROM queue_assignment_observation WHERE queue_id=? ORDER BY assigned_at,rowid',
  )
    .bind(f.queue)
    .all()
  expect(rows.results).toEqual([
    { source: 'staff', interval_ms: null, ratio: null },
    { source: 'handoff', interval_ms: null, ratio: null },
    { source: 'handoff', interval_ms: null, ratio: null },
    { source: 'staff', interval_ms: 10 * minute, ratio: 2.5 },
  ])
})

it('rejects a stale quick assignment after maintenance replaces the expected head, and old unguarded clients', async () => {
  const f = await fixture()
  await f.call(0)
  await expect(
    runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      {
        action: 'assign_next',
        expectedEntryId: f.ids[1]!,
        expectedVersion: 0,
      },
      f.at(3),
    ),
  ).rejects.toThrow('assignment_next_changed')
  expect(await f.row(1)).toMatchObject({ status: 'called' })
  expect(await f.row(2)).toMatchObject({ status: 'waiting' })
  await expect(
    runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      { action: 'assign_next' },
      f.at(3),
    ),
  ).rejects.toThrow('assignment_precondition_required')
})

it('replays successful legacy commands before checking preconditions', async () => {
  const f = await fixture()
  const key = crypto.randomUUID(),
    command = { action: 'assign_next' as const }
  await env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)')
    .bind(
      f.actor,
      key,
      await hash(JSON.stringify({ queueId: f.queue, input: command })),
      '{"ok":true}',
    )
    .run()
  expect(
    await runQueueCommand(enabled, f.actor, f.queue, key, command, f.now),
  ).toEqual({ ok: true })
  expect(await f.row(0)).toMatchObject({ status: 'waiting' })
})

it.each(['staff', 'customer'] as const)(
  'does not replace an explicit %s cancellation',
  async (who) => {
    const f = await fixture()
    await f.call(0)
    if (who === 'staff')
      await runQueueCommand(
        enabled,
        f.actor,
        f.queue,
        crypto.randomUUID(),
        { action: 'cancel', entryId: f.ids[0]!, version: 1 },
        f.at(1),
      )
    else
      await runCustomerCommand(
        enabled,
        f.queue,
        f.ids[0]!,
        crypto.randomUUID(),
        { action: 'cancel', version: 1 },
        f.at(1),
      )
    await f.expire(5)
    expect(await f.row(1)).toMatchObject({ status: 'waiting' })
    expect(await readCallReplacement(env, f.ids[0]!, 1)).toMatchObject({
      result: 'cancelled',
    })
  },
)

it('preserves eligibility and confirmed capacity through yield without arming legacy yields', async () => {
  const f = await fixture('restaurant')
  await f.call(0)
  await runCustomerCommand(
    enabled,
    f.queue,
    f.ids[0]!,
    crypto.randomUUID(),
    { action: 'yield', version: 1 },
    f.at(1),
  )
  expect(await f.policy(1)).toMatchObject({ eligible: 1 })
  await f.expire(4)
  // Yield moved the original into the next waiting position; expiry does not reorder again.
  expect(await f.row(0)).toMatchObject({ status: 'called', call_cycle: 3 })
  const row = await env.DB.prepare(
    'SELECT source,seats FROM queue_assignment_observation WHERE entry_id=? AND call_cycle=3',
  )
    .bind(f.ids[0]!)
    .first()
  expect(row).toEqual({ source: 'handoff', seats: 4 })
})

it('rolls back expiry, call, trace, estimates and notices together if the D1 batch fails', async () => {
  const f = await fixture()
  await f.call(0)
  const before = await env.DB.prepare(
    'SELECT * FROM queue_projection WHERE entry_id=?',
  )
    .bind(f.ids[1]!)
    .first()
  const broken = {
    ...enabled,
    DB: {
      prepare: env.DB.prepare.bind(env.DB),
      batch: (statements: D1PreparedStatement[]) =>
        env.DB.batch([
          ...statements,
          env.DB.prepare(
            'INSERT INTO customer_command(entry_id,request_key,request_hash,result,created_at) VALUES (NULL,NULL,NULL,NULL,NULL)',
          ),
        ]),
    } as D1Database,
  }
  await expect(f.expire(3, broken)).rejects.toThrow()
  expect(await f.row(0)).toMatchObject({ status: 'called' })
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
  expect(await f.policy(0)).toMatchObject({ result: 'pending' })
  expect(
    await env.DB.prepare('SELECT * FROM queue_projection WHERE entry_id=?')
      .bind(f.ids[1]!)
      .first(),
  ).toEqual(before)
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=? AND kind='expired'",
      )
        .bind(f.ids[0]!)
        .first()
    )?.n,
  ).toBe(0)
  await f.expire(3)
  expect(await f.row(1)).toMatchObject({ status: 'called' })
})

it('retains committed calls and their outbox when publishing fails, then safely retries publication', async () => {
  const f = await fixture()
  await f.call(0)
  const send = vi.fn().mockRejectedValue(new Error('local queue unavailable'))
  const broken = {
    ...enabled,
    NOTIFICATIONS: { send } as unknown as typeof env.NOTIFICATIONS,
  }
  await maintainQueue(broken, f.queue, f.at(3))
  expect(send).toHaveBeenCalledTimes(2)
  await maintainQueue(broken, f.queue, f.at(3))
  expect(send).toHaveBeenCalledTimes(2)
  expect(await f.row(1)).toMatchObject({ status: 'called', call_cycle: 1 })
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM notification_outbox WHERE entry_id=? AND kind='ready' AND status='pending'",
      )
        .bind(f.ids[1]!)
        .first()
    )?.n,
  ).toBe(1)
  send.mockResolvedValue(undefined)
  await publishNotice(broken, f.ids[1]!, 'ready')
  expect(send).toHaveBeenCalledTimes(3)
})

it('expires before a late confirmation and never calls twice at the exact boundary', async () => {
  const f = await fixture()
  await f.call(0)
  await expect(
    runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      {
        action: 'complete',
        entryId: f.ids[0]!,
        version: 1,
      },
      f.at(3),
    ),
  ).rejects.toThrow('version_conflict')
  await f.expire(3)
  expect(await f.row(1)).toMatchObject({ status: 'called', version: 1 })
  expect(await f.row(2)).toMatchObject({ status: 'waiting' })
})

it('records expiry and the successor call in metrics without a completion event', async () => {
  const f = await fixture()
  const metrics = { ...enabled, METRICS_CAPTURE_ENABLED: 'true' }
  await f.call(0, 0, {}, metrics)
  await f.expire(3, metrics)
  const events = await env.DB.prepare(
    "SELECT entry_id,status,first_called_at FROM metrics_event WHERE queue_id=? AND origin='arrival.expired' ORDER BY status",
  )
    .bind(f.queue)
    .all()
  expect(events.results).toEqual([
    {
      entry_id: f.ids[1],
      status: 'called',
      first_called_at: f.now + 3 * minute,
    },
    { entry_id: f.ids[0], status: 'expired', first_called_at: f.now },
  ])
})

it('runs and repairs the real coordinator alarm without a browser and serializes a competing command', async () => {
  const { runInDurableObject, runDurableObjectAlarm } = await import(
    'cloudflare:test'
  )
  const f = await fixture()
  await f.call(0)
  const stub = env.QUEUE_COORDINATOR.getByName(f.queue)
  // Scope the feature flag to this isolated coordinator instance only.
  await runInDurableObject(stub, (instance) => {
    ;(
      instance as unknown as { env: CloudflareBindings }
    ).env.QUEUE_AUTO_REPLACEMENT_ENABLED = 'true'
  })
  try {
    await stub.refresh(f.queue)
    await runInDurableObject(stub, (_instance, storage) =>
      storage.storage.deleteAlarm(),
    )
    await stub.refresh(f.queue)
    expect(
      await runInDurableObject(stub, (_instance, storage) =>
        storage.storage.getAlarm(),
      ),
    ).not.toBeNull()
    await env.DB.prepare(
      'UPDATE queue_entry SET arrival_deadline_at=? WHERE id=?',
    )
      .bind(f.now - 1, f.ids[0]!)
      .run()
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await f.row(1)).toMatchObject({ status: 'called', call_cycle: 1 })
    const [response] = await Promise.all([
      stub.staffCommand(f.actor, f.queue, crypto.randomUUID(), {
        action: 'assign_next',
        expectedEntryId: f.ids[1]!,
        expectedVersion: 0,
      }),
      stub.refresh(f.queue),
    ])
    expect(response.status).toBe(409)
    expect(await f.row(2)).toMatchObject({ status: 'waiting' })
    expect(
      await runInDurableObject(stub, (_instance, storage) =>
        storage.storage.getAlarm(),
      ),
    ).not.toBeNull()
  } finally {
    await runInDurableObject(stub, (instance) => {
      ;(
        instance as unknown as { env: CloudflareBindings }
      ).env.QUEUE_AUTO_REPLACEMENT_ENABLED = 'false'
    })
  }
})

it('carries the original service end across a replacement even if the successor has a later deadline', async () => {
  const f = await fixture()
  await env.DB.batch([
    env.DB.prepare('UPDATE queue_entry SET service_ends_at=? WHERE id=?').bind(
      f.now + 5 * minute,
      f.ids[0]!,
    ),
    env.DB.prepare('UPDATE queue_entry SET service_ends_at=? WHERE id=?').bind(
      f.now + 20 * minute,
      f.ids[1]!,
    ),
  ])
  await f.call(0)
  await f.expire(3)
  expect(await f.policy(1)).toMatchObject({
    service_ends_at: f.now + 5 * minute,
  })
  await f.expire(6)
  expect(await f.policy(1)).toMatchObject({ result: 'service_ended' })
  expect(await f.row(2)).toMatchObject({ status: 'waiting' })
})

it('uses the current grace for the successor without changing the original deadline', async () => {
  const f = await fixture()
  await f.call(0)
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify({ ...f.config, graceMinutes: 5 }), f.queue)
    .run()
  await f.expire(3)
  expect(await f.row(0)).toMatchObject({
    status: 'expired',
    arrival_deadline_at: f.now + 3 * minute,
  })
  expect(await f.row(1)).toMatchObject({
    status: 'called',
    arrival_deadline_at: f.now + 8 * minute,
  })
})

it('never arms a legacy call by yielding it after the switch is enabled', async () => {
  const f = await fixture('restaurant')
  await f.call(
    0,
    0,
    {},
    { ...enabled, QUEUE_AUTO_REPLACEMENT_ENABLED: 'false' },
  )
  await runCustomerCommand(
    enabled,
    f.queue,
    f.ids[0]!,
    crypto.randomUUID(),
    { action: 'yield', version: 1 },
    f.at(1),
  )
  expect(await f.policy(1)).toMatchObject({ eligible: 0 })
  await f.expire(4)
  expect(await f.policy(1)).toMatchObject({ result: 'disabled' })
  expect(await f.row(0)).toMatchObject({ status: 'waiting' })
})

it('does not arm an already-present assignment', async () => {
  const f = await fixture('restaurant')
  await f.call(0, 0, { arrivalMode: 'present' })
  expect(await f.row(0)).toMatchObject({
    status: 'completed',
    arrival_deadline_at: null,
  })
  expect(await f.policy(0)).toMatchObject({ eligible: 0, result: 'arrived' })
  await f.expire(3)
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
})

async function decisionFixture() {
  const f = await fixture('restaurant', 6)
  await env.DB.batch([
    env.DB.prepare('UPDATE queue_entry SET party_size=4 WHERE id=?').bind(
      f.ids[0]!,
    ),
    env.DB.prepare(
      'UPDATE queue_entry SET party_size=3 WHERE id IN (?,?)',
    ).bind(f.ids[2]!, f.ids[3]!),
    env.DB.prepare(
      "UPDATE queue_entry SET preferred_space_id='outside' WHERE id=?",
    ).bind(f.ids[4]!),
  ])
  await f.call(0)
  await f.expire(3)
  return f
}
it('persists one decision per cycle and proposes three before two, FIFO per size', async () => {
  const f = await decisionFixture()
  await f.expire(3)
  const list = await readReplacementDecisions(enabled, f.queue, f.at(3))
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({
    originalPartySize: 4,
    version: 0,
    seating: { spaceId: 'inside', seats: 4 },
    unavailable: null,
  })
  expect(list[0]!.candidates.map((p) => p.id)).toEqual([
    f.ids[2],
    f.ids[3],
    f.ids[1],
    f.ids[5],
  ])
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
  await f.add()
  await f.expire(4)
  expect(
    (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0]!.id,
  ).toBe(list[0]!.id)
})
it('resolves a decision atomically as handoff and switches the chain size without shrinking capacity', async () => {
  const f = await decisionFixture()
  const d = (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0]!
  const anchor = await env.DB.prepare(
    'SELECT last_assignment_at FROM queue_cadence_state WHERE queue_id=?',
  )
    .bind(f.queue)
    .first()
  const command = {
    action: 'resolve_replacement' as const,
    decisionId: d.id,
    decisionVersion: d.version,
    entryId: d.candidates[0]!.id,
    version: d.candidates[0]!.version,
  }
  const key = crypto.randomUUID()
  await runQueueCommand(enabled, f.actor, f.queue, key, command, f.at(4))
  await runQueueCommand(enabled, f.actor, f.queue, key, command, f.at(5))
  expect(await f.row(2)).toMatchObject({
    status: 'called',
    call_cycle: 1,
    arrival_deadline_at: f.now + 7 * minute,
  })
  expect(await readReplacementDecisions(enabled, f.queue, f.at(5))).toEqual([])
  expect(
    await env.DB.prepare(
      'SELECT last_assignment_at FROM queue_cadence_state WHERE queue_id=?',
    )
      .bind(f.queue)
      .first(),
  ).toEqual(anchor)
  expect(
    await env.DB.prepare(
      'SELECT source,interval_ms,ratio,seats FROM queue_assignment_observation WHERE entry_id=?',
    )
      .bind(f.ids[2]!)
      .first(),
  ).toMatchObject({
    source: 'handoff',
    interval_ms: null,
    ratio: null,
    seats: 4,
  })
  await f.expire(7)
  expect(await f.row(3)).toMatchObject({
    status: 'called',
    arrival_deadline_at: f.now + 10 * minute,
  })
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
  await expect(
    runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      command,
      f.at(7),
    ),
  ).rejects.toMatchObject({ status: 409 })
})
it('rejects a consumed candidate, keeps the decision and does not silently choose another', async () => {
  const f = await decisionFixture()
  const d = (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0]!
  await f.call(2, 4)
  await expect(
    runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      {
        action: 'resolve_replacement',
        decisionId: d.id,
        decisionVersion: d.version,
        entryId: f.ids[2]!,
        version: 0,
      },
      f.at(4),
    ),
  ).rejects.toMatchObject({ status: 409 })
  expect(await f.row(3)).toMatchObject({ status: 'waiting' })
  expect(
    await readReplacementDecisions(enabled, f.queue, f.at(4)),
  ).toHaveLength(1)
})
it('allows dismissing while disabled, with no call, and never recreates the decision', async () => {
  const f = await decisionFixture()
  const off = { ...enabled, QUEUE_AUTO_REPLACEMENT_ENABLED: 'false' }
  const d = (await readReplacementDecisions(off, f.queue, f.at(4)))[0]!
  expect(d).toMatchObject({ unavailable: 'disabled', candidates: [] })
  await expect(
    runQueueCommand(
      off,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      {
        action: 'resolve_replacement',
        decisionId: d.id,
        decisionVersion: 0,
        entryId: f.ids[2]!,
        version: 0,
      },
      f.at(4),
    ),
  ).rejects.toMatchObject({ status: 409 })
  await runQueueCommand(
    off,
    f.actor,
    f.queue,
    crypto.randomUUID(),
    { action: 'dismiss_replacement', decisionId: d.id, decisionVersion: 0 },
    f.at(4),
  )
  await f.expire(5)
  expect(await readReplacementDecisions(enabled, f.queue, f.at(5))).toEqual([])
  expect(await f.row(2)).toMatchObject({ status: 'waiting' })
})
it('blocks decisions with removed context and retires them at service end', async () => {
  const f = await decisionFixture()
  const d = (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0]!
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify({ ...f.config, spaces: [] }), f.queue)
    .run()
  expect(
    (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0],
  ).toMatchObject({ unavailable: 'context', candidates: [] })
  await expect(
    runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      {
        action: 'resolve_replacement',
        decisionId: d.id,
        decisionVersion: 0,
        entryId: f.ids[2]!,
        version: 0,
      },
      f.at(4),
    ),
  ).rejects.toMatchObject({ status: 409 })
  await env.DB.prepare(
    'UPDATE queue_replacement_decision SET service_ends_at=? WHERE id=?',
  )
    .bind(f.now + 5 * minute, d.id)
    .run()
  await f.expire(5)
  expect(await readReplacementDecisions(enabled, f.queue, f.at(5))).toEqual([])
  expect(
    await env.DB.prepare(
      'SELECT status FROM queue_replacement_decision WHERE id=?',
    )
      .bind(d.id)
      .first(),
  ).toEqual({ status: 'ended' })
})

it('two decisions cannot consume the same candidate, even with different command keys', async () => {
  const f = await fixture('restaurant', 5)
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE queue_entry SET party_size=4 WHERE id IN (?,?)',
    ).bind(f.ids[0]!, f.ids[1]!),
    env.DB.prepare(
      'UPDATE queue_entry SET party_size=3 WHERE id IN (?,?)',
    ).bind(f.ids[2]!, f.ids[3]!),
  ])
  await f.call(0)
  await f.call(1)
  await f.expire(3)
  const ds = await readReplacementDecisions(enabled, f.queue, f.at(4))
  expect(ds).toHaveLength(2)
  const command = {
    action: 'resolve_replacement' as const,
    decisionId: ds[0]!.id,
    decisionVersion: 0,
    entryId: f.ids[2]!,
    version: 0,
  }
  await runQueueCommand(
    enabled,
    f.actor,
    f.queue,
    crypto.randomUUID(),
    command,
    f.at(4),
  )
  await expect(
    runQueueCommand(
      enabled,
      f.actor,
      f.queue,
      crypto.randomUUID(),
      { ...command, decisionId: ds[1]!.id },
      f.at(4),
    ),
  ).rejects.toMatchObject({ status: 409 })
  expect(await f.row(2)).toMatchObject({ status: 'called', call_cycle: 1 })
  expect(await f.row(3)).toMatchObject({ status: 'waiting' })
  expect(
    await readReplacementDecisions(enabled, f.queue, f.at(4)),
  ).toHaveLength(1)
})
it('rolls back call, outbox, audit and decision on a failed resolution commit', async () => {
  const f = await decisionFixture()
  const d = (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0]!
  await env.DB.exec(
    "CREATE TRIGGER fail_decision BEFORE UPDATE ON queue_replacement_decision WHEN NEW.status='assigned' BEGIN SELECT RAISE(ABORT,'test rollback'); END;",
  )
  const key = crypto.randomUUID()
  const command = {
    action: 'resolve_replacement' as const,
    decisionId: d.id,
    decisionVersion: 0,
    entryId: f.ids[2]!,
    version: 0,
  }
  try {
    await expect(
      runQueueCommand(enabled, f.actor, f.queue, key, command, f.at(4)),
    ).rejects.toThrow()
    expect(await f.row(2)).toMatchObject({ status: 'waiting', call_cycle: 0 })
    expect(
      await env.DB.prepare(
        "SELECT id FROM notification_outbox WHERE entry_id=? AND kind='ready'",
      )
        .bind(f.ids[2]!)
        .first(),
    ).toBeNull()
    expect(
      await env.DB.prepare('SELECT * FROM staff_command WHERE request_key=?')
        .bind(key)
        .first(),
    ).toBeNull()
    expect(
      (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0]!.version,
    ).toBe(0)
  } finally {
    await env.DB.exec('DROP TRIGGER fail_decision;')
  }
  await runQueueCommand(enabled, f.actor, f.queue, key, command, f.at(4))
  expect(await f.row(2)).toMatchObject({ status: 'called', call_cycle: 1 })
})
it('does not train a shorter human interval after manually choosing an alternative', async () => {
  const f = await decisionFixture()
  const d = (await readReplacementDecisions(enabled, f.queue, f.at(4)))[0]!
  await runQueueCommand(
    enabled,
    f.actor,
    f.queue,
    crypto.randomUUID(),
    {
      action: 'resolve_replacement',
      decisionId: d.id,
      decisionVersion: 0,
      entryId: f.ids[2]!,
      version: 0,
    },
    f.at(4),
  )
  await f.call(1, 10)
  expect(
    await env.DB.prepare(
      'SELECT source,interval_ms FROM queue_assignment_observation WHERE entry_id=?',
    )
      .bind(f.ids[1]!)
      .first(),
  ).toMatchObject({ source: 'staff', interval_ms: 10 * minute })
})
it('an equal-size group joining later is offered manually without reactivating the chain', async () => {
  const f = await fixture('restaurant', 1)
  await env.DB.prepare('UPDATE queue_entry SET party_size=4 WHERE id=?')
    .bind(f.ids[0]!)
    .run()
  await f.call(0)
  await f.expire(3)
  const id = await f.add()
  await env.DB.prepare('UPDATE queue_entry SET party_size=4 WHERE id=?')
    .bind(id)
    .run()
  await f.expire(4)
  expect(await f.row(1)).toMatchObject({ status: 'waiting' })
  const ds = await readReplacementDecisions(enabled, f.queue, f.at(4))
  expect(ds).toHaveLength(1)
  expect(ds[0]!.candidates[0]!.id).toBe(id)
})
