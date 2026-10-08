import { env } from 'cloudflare:workers'
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { runQueueCommand } from '../staff/commands'
import { joinQueue } from './entries'
import { expireArrivals } from './customer'
import { maintainServiceEntries } from './service-expiry'
import { dispatchNotificationSerialized } from './notifications'

const network = setupNetwork()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
const endpoint = 'https://waba-sandbox.360dialog.io/v1/messages'
async function fixture(configured = false) {
  const actor = crypto.randomUUID(),
    org = crypto.randomUUID(),
    venue = crypto.randomUUID(),
    queue = crypto.randomUUID()
  const config = configured
    ? JSON.stringify({
        name: 'Actual service',
        type: 'reception',
        capacity: 20,
        averageMinutes: 30,
        graceMinutes: 2,
        cutoffMinutes: 0,
        twentyFourHours: true,
        schedules: [],
        receptionServices: ['other'],
        stations: 1,
        spaces: [],
      })
    : null
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,datetime('now'),datetime('now'))",
    ).bind(actor, 'Example actor', `${actor}@test.invalid`),
    env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(
      org,
      'Example organization',
    ),
    env.DB.prepare(
      'INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)',
    ).bind(org, actor),
    env.DB.prepare(
      'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
    ).bind(venue, org, 'Example venue'),
    env.DB.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,'owner',datetime('now'))",
    ).bind(crypto.randomUUID(), org, actor),
    env.DB.prepare(
      "INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,'owner')",
    ).bind(actor, venue),
    env.DB.prepare(
      "INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,20,30,1,'Legacy',?)",
    ).bind(queue, venue, config),
  ])
  const joined = await joinQueue(
    { ...env, WHATSAPP_COPY_VERSION: '2' },
    queue,
    crypto.randomUUID(),
    {
      partySize: 1,
      locale: 'es',
      whatsapp: {
        consent: true,
        phone: '+34600000000',
        version: 'whatsapp-queue-updates-v1',
      },
    },
  )
  expect(joined.status).toBe(201)
  const entry = await env.DB.prepare(
    'SELECT id FROM queue_entry WHERE queue_id=?',
  )
    .bind(queue)
    .first<{ id: string }>()
  if (!entry) throw new Error('Missing consented turn')
  return { actor, queue, entry: entry.id }
}

for (const configured of [false, true]) {
  it.each(['call', 'cancel', 'expiry', 'service-end'] as const)(
    `${
      configured ? 'configured' : 'legacy'
    } real %s path respects actual service configuration`,
    async (action) => {
      const t = await fixture(configured),
        now = Date.now()
      const selected = { ...env, WHATSAPP_COPY_VERSION: '3' }
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let requests = 0
      network.use(
        http.post(endpoint, () => {
          requests++
          return HttpResponse.json({
            messages: [{ id: `mock-configured-${t.entry}-${requests}` }],
          })
        }),
      )
      try {
        let kind: string, status: string
        if (action === 'call' || action === 'cancel') {
          await expect(
            runQueueCommand(
              selected,
              t.actor,
              t.queue,
              crypto.randomUUID(),
              action === 'call'
                ? { action: 'assign_next' }
                : { action, entryId: t.entry, version: 0 },
              now,
            ),
          ).resolves.toEqual({ ok: true })
          kind = action === 'call' ? 'ready' : 'cancelled'
          status = action === 'call' ? 'called' : 'cancelled'
        } else if (action === 'expiry') {
          await runQueueCommand(
            { ...env, WHATSAPP_COPY_VERSION: '2' },
            t.actor,
            t.queue,
            crypto.randomUUID(),
            { action: 'assign_next' },
            now,
          )
          await env.DB.prepare(
            'UPDATE queue_entry SET arrival_deadline_at=? WHERE id=?',
          )
            .bind(now, t.entry)
            .run()
          await expireArrivals(selected, t.queue, now)
          kind = 'expired'
          status = 'expired'
        } else {
          await env.DB.prepare(
            'UPDATE queue_entry SET service_window_id=?,service_ends_at=? WHERE id=?',
          )
            .bind('previous-service-window', now, t.entry)
            .run()
          await maintainServiceEntries(selected, t.queue, now)
          kind = 'service_ended'
          status = 'cancelled'
        }
        expect(
          (
            await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
              .bind(t.entry)
              .first()
          )?.status,
        ).toBe(status)
        const notice = await env.DB.prepare(
          'SELECT id,status,payload_snapshot,call_cycle FROM notification_outbox WHERE entry_id=? AND kind=?',
        )
          .bind(t.entry, kind)
          .first<{
            id: string
            status: string
            payload_snapshot: string
            call_cycle: number
          }>()
        expect(notice?.status).toBe(configured ? 'pending' : 'failed')
        if (!notice) throw new Error('Missing observable intent')
        if (configured)
          expect(JSON.parse(notice.payload_snapshot).serviceName).toBe(
            'Actual service',
          )
        else {
          expect(JSON.parse(notice.payload_snapshot)).toEqual({
            schemaVersion: 2,
            copyVersion: 3,
            blockedReason: 'configured_service_required',
          })
          expect(warning.mock.calls).toContainEqual([
            {
              event: 'whatsapp_copy_profile_unavailable',
              reason: 'configured_service_required',
            },
          ])
        }
        if (action === 'call') expect(notice.call_cycle).toBe(1)
        await dispatchNotificationSerialized(selected, notice.id)
        expect(requests).toBe(configured ? 1 : 0)
      } finally {
        warning.mockRestore()
      }
    },
  )
}

it('keeps historical v1 joined and v2 ready rendering despite selecting v3 for later intents', async () => {
  const t = await fixture()
  const bodies: string[] = []
  network.use(
    http.post(endpoint, async ({ request }) => {
      const payload = (await request.json()) as { text: { body: string } }
      bodies.push(payload.text.body)
      return HttpResponse.json({
        messages: [{ id: `mock-history-${bodies.length}` }],
      })
    }),
  )
  const joined = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE entry_id=? AND kind='queue_joined'",
  )
    .bind(t.entry)
    .first<{ id: string }>()
  await dispatchNotificationSerialized(
    { ...env, WHATSAPP_COPY_VERSION: '3' },
    joined!.id,
  )
  await runQueueCommand(
    { ...env, WHATSAPP_COPY_VERSION: '2' },
    t.actor,
    t.queue,
    crypto.randomUUID(),
    { action: 'assign_next' },
  )
  const ready = await env.DB.prepare(
    "SELECT id FROM notification_outbox WHERE entry_id=? AND kind='ready'",
  )
    .bind(t.entry)
    .first<{ id: string }>()
  await dispatchNotificationSerialized(
    { ...env, WHATSAPP_COPY_VERSION: '3' },
    ready!.id,
  )
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toContain('Example venue: tu turno es')
  expect(bodies[1]).toContain('tu turno está asignado en Recepción')
  expect(bodies[1]).not.toContain('¡Ya es tu turno!')
})

it.each(['call', 'expiry', 'service-end'] as const)(
  'preserves the existing revoked-consent intent gate for legacy %s',
  async (action) => {
    const t = await fixture(),
      now = Date.now()
    await env.DB.prepare('UPDATE consent SET revoked_at=? WHERE entry_id=?')
      .bind(now, t.entry)
      .run()
    const selected = { ...env, WHATSAPP_COPY_VERSION: '3' }
    let kind: string
    if (action === 'service-end') {
      await env.DB.prepare(
        'UPDATE queue_entry SET service_window_id=?,service_ends_at=? WHERE id=?',
      )
        .bind('previous-service-window', now, t.entry)
        .run()
      await maintainServiceEntries(selected, t.queue, now)
      kind = 'service_ended'
    } else {
      await runQueueCommand(
        action === 'call' ? selected : { ...env, WHATSAPP_COPY_VERSION: '2' },
        t.actor,
        t.queue,
        crypto.randomUUID(),
        { action: 'assign_next' },
        now,
      )
      kind = 'ready'
      if (action === 'expiry') {
        await env.DB.prepare(
          'UPDATE queue_entry SET arrival_deadline_at=? WHERE id=?',
        )
          .bind(now, t.entry)
          .run()
        await expireArrivals(selected, t.queue, now)
        kind = 'expired'
      }
    }
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM notification_outbox WHERE entry_id=? AND kind=?',
      )
        .bind(t.entry, kind)
        .first(),
    ).toEqual({ count: 0 })
  },
)
