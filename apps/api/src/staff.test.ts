import { issueLocationToken } from './features/staff/location'
import { env } from 'cloudflare:workers'
import {
  vi,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
} from 'vitest'
import { setupNetwork } from '../test/fake-network'
import { http, HttpResponse } from 'msw'
import { app } from './app'
import { createAuth } from './auth/server'
import { provisionSchema, type ProvisionInput } from '@noqueue/contracts/staff'
import { provision } from './features/staff/provision'
import { profileD1 } from '../test/d1-profile'
import { applyD1Migrations } from 'cloudflare:test'
const network = setupNetwork(),
  mails = new Map<string, string>()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rateLimit').run()
  mails.clear()
  network.use(
    http.post('https://api.resend.com/emails', async ({ request }) => {
      const body = (await request.json()) as { to: string[]; text: string }
      mails.set(body.to[0]!, body.text)
      return HttpResponse.json({ id: 'mock' })
    }),
  )
})
const origin = 'http://localhost:5173',
  password = 'test-only-password-12345'
function request(
  path: string,
  cookie = '',
  method = 'GET',
  body?: unknown,
  key?: string,
) {
  return app.request(
    `${origin}/api/v1${path}`,
    {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  )
}
function username() {
  return 'u' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
}
async function login(name: string, pass = password) {
  await env.DB.prepare('DELETE FROM rateLimit').run()
  const response = await request('/auth/sign-in/username', '', 'POST', {
    username: name,
    password: pass,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ')
}
async function identity(role = 'user') {
  const name = username(),
    email = `${name}@accounts.noqueue.invalid`
  const user = (
    await createAuth(env).api.createUser({
      body: {
        name: 'Test User',
        email,
        password,
        role: role as 'user',
        data: { username: name },
      },
    })
  ).user
  return { id: user.id, email, username: name, cookie: await login(name) }
}
function input(name = username()): ProvisionInput {
  return {
    locationToken: '',
    locationOperationId: crypto.randomUUID(),
    organizationName: 'Hotel Test',
    slug: `hotel-${crypto.randomUUID()}`,
    venueName: 'Hotel Madrid',
    timezone: 'Europe/Madrid',
    ownerName: 'Hotel Owner',
    ownerUsername: name,
    ownerPassword: password,
    services: [
      {
        name: 'Restaurant',
        type: 'restaurant',
        capacity: 20,
        averageMinutes: 30,
        graceMinutes: 5,
        cutoffMinutes: 0,
        twentyFourHours: true,
        schedules: [],
        spaces: [{ name: 'Interior', tables: 10 }],
        receptionServices: [],
      },
    ],
  }
}
async function withLocation(actor: string, data = input()) {
  const candidate = await issueLocationToken(
    env,
    actor,
    { kind: 'provision', id: data.locationOperationId },
    {
      formatted: 'Calle Mayor 1, Madrid',
      latitude: 40.416,
      longitude: -3.704,
      address: {
        street: 'Calle Mayor',
        houseNumber: '1',
        city: 'Madrid',
        countryCode: 'es',
      },
      provider: 'geoapify',
      providerId: 'fixture',
      attribution: [{ text: 'Geoapify', url: 'https://www.geoapify.com/' }],
    },
  )
  return { ...data, locationToken: candidate.token }
}
async function tenant() {
  const sales = await identity('commercial_operator'),
    data = await withLocation(sales.id)
  const result = await provision(env, sales.id, crypto.randomUUID(), data)
  const owner = {
    id: result.userId,
    email: `${result.userId}@accounts.noqueue.invalid`,
    username: data.ownerUsername,
    cookie: await login(data.ownerUsername),
  }
  const queue = await env.DB.prepare('SELECT id FROM queue WHERE venue_id=?')
    .bind(result.venueId)
    .first<{ id: string }>()
  return { sales, owner, ...result, queueId: queue!.id }
}
async function member(
  t: Awaited<ReturnType<typeof tenant>>,
  role = 'queue_staff',
) {
  const name = username()
  const r = await request(
    `/staff/venues/${t.venueId}/members`,
    t.owner.cookie,
    'POST',
    {
      name: 'Staff',
      username: name,
      password,
      role,
      ...(role === 'queue_staff' ? { queueIds: [t.queueId] } : {}),
    },
  )
  expect(r.status).toBe(201)
  const { id } = (await r.json()) as { id: string }
  return { id, username: name, cookie: await login(name) }
}
describe('manual username authentication and scoped provisioning', () => {
  it('closes signup, OTP, global admin and organization bypasses', async () => {
    expect((await request('/staff/me')).status).toBe(401)
    for (const path of [
      '/sign-up/email',
      '/email-otp/send-verification-otp',
      '/sign-in/email-otp',
      '/admin/create-user',
      '/organization/create',
      '/is-username-available',
    ])
      expect((await request(`/auth${path}`, '', 'POST', {})).status).toBe(404)
    expect(
      provisionSchema.safeParse({ ...input(), timezone: 'bad-zone' }).success,
    ).toBe(false)
  })
  it('allows first login without email verification or mandatory password change, and rejects bad credentials/origin', async () => {
    const user = await identity()
    expect((await request('/staff/me', user.cookie)).status).toBe(200)
    expect(mails.size).toBe(0)
    expect(
      (
        await request('/auth/sign-in/username', '', 'POST', {
          username: user.username,
          password: 'incorrect',
        })
      ).status,
    ).not.toBe(200)
    const row = await env.DB.prepare(
      'SELECT emailVerified FROM user WHERE id=?',
    )
      .bind(user.id)
      .first<{ emailVerified: number }>()
    expect(row?.emailVerified).toBe(0)
    const r = await app.request(
      `${origin}/api/v1/auth/sign-out`,
      {
        method: 'POST',
        headers: { Origin: 'https://attacker.invalid', Cookie: user.cookie },
      },
      env,
    )
    expect(r.status).toBe(403)
  })
  it('provisions atomically, idempotently, without mail or stored plaintext; rejects username takeover', async () => {
    const sales = await identity('commercial_operator'),
      data = await withLocation(sales.id),
      key = crypto.randomUUID()
    const [a, b] = await Promise.all([
      provision(env, sales.id, key, data),
      provision(env, sales.id, key, data),
    ])
    expect(a).toEqual(b)
    await expect(
      provision(env, sales.id, key, { ...data, venueName: 'Different' }),
    ).rejects.toThrow('idempotency_conflict')
    await expect(
      provision(env, sales.id, crypto.randomUUID(), {
        ...data,
        slug: 'other-' + crypto.randomUUID(),
      }),
    ).rejects.toThrow('username_unavailable')
    expect(mails.size).toBe(0)
    const result = await env.DB.prepare(
      'SELECT result,request_hash FROM provisioning_request WHERE request_key=?',
    )
      .bind(key)
      .first()
    expect(JSON.stringify(result)).not.toContain(password)
    const account = await env.DB.prepare(
      'SELECT password FROM account WHERE userId=?',
    )
      .bind(a.userId)
      .first<{ password: string }>()
    expect(account?.password).not.toBe(password)
    expect(
      await env.DB.prepare(
        'SELECT id FROM member WHERE userId=? AND organizationId=?',
      )
        .bind(sales.id, a.organizationId)
        .first(),
    ).toBeNull()
    expect(
      (
        await env.DB.prepare('SELECT open FROM queue WHERE venue_id=?')
          .bind(a.venueId)
          .first<{ open: number }>()
      )?.open,
    ).toBe(0)
  })
  it('enforces tenant roles, owner protection and revocation with existing sessions', async () => {
    const t = await tenant(),
      staff = await member(t),
      outsider = await identity()
    expect(
      (await request(`/staff/queues/${t.queueId}/entries`, staff.cookie))
        .status,
    ).toBe(200)
    expect(
      (await request(`/staff/venues/${t.venueId}/members`, staff.cookie))
        .status,
    ).toBe(403)
    expect(
      (await request(`/staff/queues/${t.queueId}`, staff.cookie, 'PATCH', {}))
        .status,
    ).toBe(403)
    expect(
      (await request(`/staff/venues/${t.venueId}/queues`, outsider.cookie))
        .status,
    ).toBe(404)
    expect(
      (
        await request(
          '/staff/commercial/organizations',
          t.owner.cookie,
          'POST',
          input(),
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(
          `/staff/venues/${t.venueId}/members/${t.owner.id}`,
          t.owner.cookie,
          'PATCH',
          { role: 'viewer', active: false },
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(
          `/staff/venues/${t.venueId}/members/${staff.id}`,
          t.owner.cookie,
          'PATCH',
          { role: 'viewer', active: false },
        )
      ).status,
    ).toBe(200)
    expect(
      (await request(`/staff/queues/${t.queueId}/entries`, staff.cookie))
        .status,
    ).toBe(404)
  })
  it('changes profile and password voluntarily, rejects privilege fields and revokes other sessions', async () => {
    const user = await identity(),
      other = await login(user.username)
    expect(
      (
        await request('/auth/update-user', user.cookie, 'POST', {
          name: 'New Name',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request('/auth/update-user', user.cookie, 'POST', {
          role: 'platform_admin',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request('/auth/change-password', user.cookie, 'POST', {
          currentPassword: 'bad',
          newPassword: 'new-test-password-123',
          revokeOtherSessions: true,
        })
      ).status,
    ).not.toBe(200)
    expect(
      (
        await request('/auth/change-password', user.cookie, 'POST', {
          currentPassword: password,
          newPassword: 'new-test-password-123',
          revokeOtherSessions: true,
        })
      ).status,
    ).toBe(200)
    expect((await request('/staff/me', other)).status).toBe(401)
    await login(user.username, 'new-test-password-123')
  })
  it('keeps synthetic email until new address is verified without access to the old mailbox', async () => {
    const user = await identity(),
      newEmail = `${username()}@example.com`
    const result = await request('/auth/change-email', user.cookie, 'POST', {
      newEmail,
      callbackURL: '/settings/account',
    })
    expect(result.status, await result.clone().text()).toBe(200)
    expect(
      (
        await env.DB.prepare('SELECT email FROM user WHERE id=?')
          .bind(user.id)
          .first<{ email: string }>()
      )?.email,
    ).toBe(user.email)
    const url = mails.get(newEmail)?.match(/https?:\/\/\S+/)?.[0]
    expect(url).toBeTruthy()
    const verified = await app.request(
      url!,
      { headers: { Cookie: user.cookie } },
      env,
    )
    expect([200, 302]).toContain(verified.status)
    const row = await env.DB.prepare(
      'SELECT email,emailVerified FROM user WHERE id=?',
    )
      .bind(user.id)
      .first<{ email: string; emailVerified: number }>()
    expect(row).toMatchObject({ email: newEmail, emailVerified: 1 })
    await login(user.username)
    expect(
      (
        await request('/auth/change-email', user.cookie, 'POST', {
          newEmail: 'bad@accounts.noqueue.invalid',
        })
      ).status,
    ).toBe(400)
  })
  it('manual resets revoke sessions and reject cross-tenant and multi-tenant identity resets', async () => {
    const t = await tenant(),
      staff = await member(t),
      other = await tenant(),
      newPassword = 'manually-reset-password-123'
    const path = `/staff/venues/${t.venueId}/members/${staff.id}/password`
    expect(
      (
        await request(path, other.owner.cookie, 'POST', {
          password: newPassword,
        })
      ).status,
    ).toBe(404)
    expect(
      (await request(path, t.owner.cookie, 'POST', { password: newPassword }))
        .status,
    ).toBe(200)
    expect((await request('/staff/me', staff.cookie)).status).toBe(401)
    await login(staff.username, newPassword)
    expect(
      (
        await request(
          `/staff/venues/${t.venueId}/members/${t.owner.id}/password`,
          t.owner.cookie,
          'POST',
          { password: newPassword },
        )
      ).status,
    ).toBe(403)
    await env.DB.prepare(
      'INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        other.organizationId,
        staff.id,
        'member',
        new Date().toISOString(),
      )
      .run()
    expect(
      (await request(path, t.owner.cookie, 'POST', { password: newPassword }))
        .status,
    ).toBe(403)
  })
  it('keeps auth usable without mail configuration and does not change email on delivery failure', async () => {
    const user = await identity()
    const response = await app.request(
      `${origin}/api/v1/auth/change-email`,
      {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: user.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newEmail: 'real@example.com' }),
      },
      { ...env, AUTH_EMAIL_API_KEY: '' },
    )
    expect(response.status).toBe(503)
    network.use(
      http.post(
        'https://api.resend.com/emails',
        () => new HttpResponse(null, { status: 503 }),
      ),
    )
    const failed = await request('/auth/change-email', user.cookie, 'POST', {
      newEmail: `${username()}@example.com`,
    })
    // Better Auth intentionally returns a uniform response even if the delivery callback fails.
    expect(failed.status).toBe(200)
    expect(
      (
        await env.DB.prepare('SELECT email FROM user WHERE id=?')
          .bind(user.id)
          .first<{ email: string }>()
      )?.email,
    ).toBe(user.email)
    expect((await request('/staff/me', user.cookie)).status).toBe(200)
  })
  it('rate limits repeated password attempts', async () => {
    const name = username(),
      statuses: number[] = []
    for (let i = 0; i < 12; i++)
      statuses.push(
        (
          await request('/auth/sign-in/username', '', 'POST', {
            username: name,
            password: 'wrong-password-12345',
          })
        ).status,
      )
    expect(statuses).toContain(429)
    expect(statuses).not.toContain(200)
  })
  it('rolls back new credential identities when tenant creation fails', async () => {
    const data = await withLocation('missing-actor')
    await expect(
      provision(env, 'missing-actor', crypto.randomUUID(), data),
    ).rejects.toThrow()
    expect(
      await env.DB.prepare('SELECT id FROM user WHERE username=?')
        .bind(data.ownerUsername)
        .first(),
    ).toBeNull()
    expect(
      await env.DB.prepare('SELECT id FROM organization WHERE slug=?')
        .bind(data.slug)
        .first(),
    ).toBeNull()
  })
  it('serializes commands, rejects stale versions and replays without duplicating audit', async () => {
    const t = await tenant(),
      entryId = crypto.randomUUID(),
      now = Date.now()
    await configureAndOpen(t, t.queueId, {
      ...input().services[0]!,
      spaces: [
        {
          id: 'main',
          name: 'Main',
          tables: 1,
          tableTypes: [{ seats: 4, count: 1 }],
        },
      ],
    })
    await env.DB.prepare(
      `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,2,'es',?,1)`,
    )
      .bind(
        entryId,
        t.queueId,
        crypto.randomUUID(),
        'hash',
        crypto.randomUUID(),
        crypto.randomUUID(),
        now,
      )
      .run()
    const key = crypto.randomUUID(),
      body = { entryId, version: 0, action: 'call' }
    const [a, b] = await Promise.all([
      request(
        `/staff/queues/${t.queueId}/commands`,
        t.owner.cookie,
        'POST',
        body,
        key,
      ),
      request(
        `/staff/queues/${t.queueId}/commands`,
        t.owner.cookie,
        'POST',
        body,
        key,
      ),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(
      (
        await request(
          `/staff/queues/${t.queueId}/commands`,
          t.owner.cookie,
          'POST',
          { entryId, version: 0, action: 'cancel' },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await request(
          `/staff/queues/${t.queueId}/commands`,
          t.owner.cookie,
          'POST',
          { entryId, version: 1, action: 'no_show' },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await request(
          `/staff/queues/${t.queueId}/commands`,
          t.owner.cookie,
          'POST',
          { entryId, version: 1, action: 'complete' },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200)
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM staff_audit WHERE target_id=? AND action='queue.call'",
    )
      .bind(entryId)
      .first<{ n: number }>()
    expect(count!.n).toBe(1)
  })
  it('lets the provisioning commercial read and update a service, and hides it from other sales staff', async () => {
    const t = await tenant()
    const other = await identity('commercial_operator')
    const list = await request(
      `/staff/venues/${t.venueId}/queues`,
      t.sales.cookie,
    )
    expect(list.status).toBe(200)
    const queues = (await list.json()) as {
      id: string
      version: number
      open: number
      config: Record<string, unknown>
    }[]
    const queue = queues.find((item) => item.id === t.queueId)
    expect(queue).toBeTruthy()
    expect(
      (
        await request(`/staff/queues/${t.queueId}`, t.sales.cookie, 'PATCH', {
          ...queue!.config,
          name: 'Terraza',
          version: queue!.version,
          open: !!queue!.open,
        })
      ).status,
    ).toBe(200)
    expect(
      (await request(`/staff/venues/${t.venueId}/queues`, other.cookie)).status,
    ).toBe(404)
    expect(
      (
        await request(
          `/staff/queues/${t.queueId}/commands`,
          t.sales.cookie,
          'POST',
          { entryId: crypto.randomUUID(), version: 0, action: 'call' },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(404)
  })
  it('denies a previously authenticated commercial after server role removal', async () => {
    const sales = await identity('commercial_operator')
    await env.DB.prepare("UPDATE user SET role='user' WHERE id=?")
      .bind(sales.id)
      .run()
    expect(
      (await request('/staff/commercial/organizations', sales.cookie)).status,
    ).toBe(403)
  })
})
describe('service lifecycle and public access', () => {
  it('creates a service idempotently, enforces capacity and suspends existing sessions and joins', async () => {
    const t = await tenant()
    const service = {
      ...input(t.owner.email).services[0]!,
      type: 'pool',
      capacity: 2,
    }
    const key = crypto.randomUUID()
    const path = `/staff/venues/${t.venueId}/queues`
    const created = await request(path, t.owner.cookie, 'POST', service, key)
    expect(created.status).toBe(201)
    const result = (await created.json()) as { id: string }
    const replay = await request(path, t.owner.cookie, 'POST', service, key)
    expect(await replay.json()).toEqual(result)
    expect(
      (
        await request(
          path,
          t.owner.cookie,
          'POST',
          { ...service, name: 'Other' },
          key,
        )
      ).status,
    ).toBe(409)
    await configureAndOpen(t, result.id, service)
    const joinPath = `/public/services/${result.id}/entries`
    const joined = await request(
      joinPath,
      '',
      'POST',
      { displayName: 'Guest', partySize: 1, locale: 'es' },
      crypto.randomUUID(),
    )
    expect(joined.status).toBe(201)
    expect((await request(joinPath, '', 'POST', { displayName: 'Second', partySize: 1, locale: 'es' }, crypto.randomUUID())).status).toBe(201)
    expect(
      (
        await request(
          joinPath,
          '',
          'POST',
          { displayName: 'Guest', partySize: 1, locale: 'es' },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await request(
          `/staff/commercial/organizations/${t.organizationId}/status`,
          t.owner.cookie,
          'PATCH',
          { status: 'suspended' },
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(
          `/staff/commercial/organizations/${t.organizationId}/status`,
          t.sales.cookie,
          'PATCH',
          { status: 'suspended' },
        )
      ).status,
    ).toBe(200)
    expect(
      (await request(`/staff/queues/${result.id}/entries`, t.owner.cookie))
        .status,
    ).toBe(404)
    expect(
      (
        await request(
          joinPath,
          '',
          'POST',
          { partySize: 1, locale: 'es' },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(404)
  })
})

describe('platform establishment navigation', () => {
  it('paginates over 100 venues with stable ties and scopes operator access', async () => {
    const t = await tenant()
    await env.DB.batch(
      Array.from({ length: 104 }, (_, index) =>
        env.DB.prepare(
          'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
        ).bind(
          `pagination-${t.venueId}-${String(index).padStart(3, '0')}`,
          t.organizationId,
          'Same name',
        ),
      ),
    )
    const seen: string[] = []
    for (let page = 1; page <= 5; page++) {
      const response = await request(
        `/staff/commercial/organizations?page=${page}`,
        t.sales.cookie,
      )
      expect(response.status).toBe(200)
      const data = (await response.json()) as {
        items: { venueId: string }[]
        page: number
        hasMore: boolean
      }
      expect(data.page).toBe(page)
      expect(data.items).toHaveLength(page < 5 ? 24 : 9)
      expect(data.hasMore).toBe(page < 5)
      seen.push(...data.items.map((item) => item.venueId))
    }
    expect(seen).toEqual([...seen].sort())
    expect(new Set(seen).size).toBe(105)
    expect(
      await (
        await request('/staff/commercial/organizations?page=6', t.sales.cookie)
      ).json(),
    ).toEqual({ items: [], page: 6, hasMore: false })
    for (const page of ['0', '-1', '1.5', 'abc', '9007199254740991'])
      expect(
        (
          await request(
            `/staff/commercial/organizations?page=${page}`,
            t.sales.cookie,
          )
        ).status,
      ).toBe(400)
    const other = await identity('commercial_operator')
    expect(
      await (
        await request('/staff/commercial/organizations', other.cookie)
      ).json(),
    ).toEqual({ items: [], page: 1, hasMore: false })
  })
  it('exposes platform role, allows scoped commercial identity lookup and denies operations', async () => {
    const t = await tenant(),
      admin = await identity('platform_admin')
    expect(
      await (await request('/staff/me', admin.cookie)).json(),
    ).toMatchObject({ platformAdmin: true })
    expect(
      await (await request('/staff/me', t.sales.cookie)).json(),
    ).toMatchObject({ platformAdmin: false })
    const path = `/staff/commercial/venues/${t.venueId}`
    expect(await (await request(path, admin.cookie)).json()).toMatchObject({
      id: t.venueId,
      name: 'Hotel Madrid',
      organizationId: t.organizationId,
      organizationName: 'Hotel Test',
    })
    expect((await request(path, t.sales.cookie)).status).toBe(200)
    const other = await identity('commercial_operator')
    expect((await request(path, other.cookie)).status).toBe(404)
    expect((await request(path, t.owner.cookie)).status).toBe(403)
    expect(
      (await request('/staff/commercial/venues/missing', admin.cookie)).status,
    ).toBe(404)
    expect((await request(path)).status).toBe(401)
    for (const cookie of [admin.cookie, t.sales.cookie])
      expect(
        (
          await request(
            `/staff/queues/${t.queueId}/commands`,
            cookie,
            'POST',
            {},
            crypto.randomUUID(),
          )
        ).status,
      ).toBe(404)
  })
})

it('assigns waiting turns independently of historical inventory and completes on arrival', async () => {
  const t = await tenant()
  const config = {
    ...input().services[0]!,
    estimationMode: 'active',
    resourceStateKnown: true,
    spaces: [
      {
        id: 'room',
        name: 'Room',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }],
      },
    ],
  }
  await configureAndOpen(t, t.queueId, config)
  const ids: string[] = []
  for (let i = 1; i <= 2; i++) {
    const id = crypto.randomUUID()
    ids.push(id)
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,2,'en',?,?)",
    )
      .bind(id, t.queueId, id, 'hash', id, id, Date.now(), i)
      .run()
  }
  const command = (
    entryId: string,
    version: number,
    action: string,
    key = crypto.randomUUID(),
  ) =>
    request(
      `/staff/queues/${t.queueId}/commands`,
      t.owner.cookie,
      'POST',
      { entryId, version, action },
      key,
    )
  const results = await Promise.all([
    command(ids[0]!, 0, 'call'),
    command(ids[1]!, 0, 'call'),
  ])
  expect(results.map((r) => r.status)).toEqual([200, 200])
  // Human assignments are the queue's progress signal, not table reservations.
  expect(
    (await env.DB.prepare('SELECT COUNT(*) n FROM queue_allocation WHERE queue_id=?')
      .bind(t.queueId).first<{ n: number }>())?.n,
  ).toBe(0)
  expect((await command(ids[0]!, 1, 'complete')).status).toBe(200)
  const completed = await env.DB.prepare('SELECT status,arrival_deadline_at FROM queue_entry WHERE id=?')
    .bind(ids[0]!).first<{status:string;arrival_deadline_at:number|null}>()
  expect(completed?.status).toBe('completed')
  expect(completed?.arrival_deadline_at).not.toBeNull()
  // Arrival is terminal; physical release operations are no longer part of the queue API.
  expect((await command(ids[0]!, 2, 'release')).status).toBe(410)
  expect((await command(ids[1]!, 1, 'complete')).status).toBe(200)
  expect(
    (await env.DB.prepare('SELECT COUNT(*) n FROM queue_allocation WHERE queue_id=?')
      .bind(t.queueId).first<{ n: number }>())?.n,
  ).toBe(0)
})

it('allows a non-priority waiting turn without an override reason and preserves no-show/cancel rules', async () => {
  const t = await tenant()
  const config = {
    ...input().services[0]!,
    estimationMode: 'active',
    resourceStateKnown: true,
    spaces: [
      {
        id: 'small',
        name: 'Small',
        tables: 1,
        tableTypes: [{ seats: 2, count: 1, averageMinutes: 20 }],
      },
    ],
  }
  await configureAndOpen(t, t.queueId, config)
  const ids: string[] = []
  for (let i = 1; i <= 3; i++) {
    const id = crypto.randomUUID()
    ids.push(id)
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,?,'en',?,?)",
    )
      .bind(id, t.queueId, id, 'hash', id, id, i === 1 ? 6 : 2, Date.now(), i)
      .run()
  }
  const command = (
    index: number,
    version: number,
    action: string,
    overrideReason?: string,
  ) =>
    request(
      `/staff/queues/${t.queueId}/commands`,
      t.owner.cookie,
      'POST',
      {
        entryId: ids[index]!,
        version,
        action,
        ...(overrideReason ? { overrideReason } : {}),
      },
      crypto.randomUUID(),
    )
  expect((await command(2, 0, 'call')).status).toBe(200)
  expect(
    await env.DB.prepare('SELECT 1 FROM queue_override_audit WHERE entry_id=?')
      .bind(ids[2]!).first(),
  ).toBeNull()
  // Manual no-show applies to legacy calls without a persisted arrival deadline.
  await env.DB.prepare(
    'UPDATE queue_entry SET arrival_deadline_at=NULL WHERE id=?',
  )
    .bind(ids[2]!)
    .run()
  expect((await command(2, 1, 'no_show')).status).toBe(409)
  await env.DB.prepare('UPDATE queue_entry SET called_at=? WHERE id=?')
    .bind(Date.now() - 6 * 60000, ids[2]!)
    .run()
  expect((await command(2, 1, 'no_show')).status).toBe(200)
  expect((await command(1, 0, 'call')).status).toBe(200)
  expect((await command(1, 1, 'cancel')).status).toBe(200)
  expect((await command(0, 0, 'skip')).status).toBe(409)
  const row = await env.DB.prepare(
    'SELECT sequence,status FROM queue_entry WHERE id=?',
  )
    .bind(ids[0]!)
    .first<{ sequence: number; status: string }>()
  expect(row).toMatchObject({ status: 'waiting', sequence: 1 })
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM queue_allocation WHERE queue_id=? AND arrived_at IS NOT NULL AND outcome='served'",
      )
        .bind(t.queueId)
        .first<{ n: number }>()
    )?.n,
  ).toBe(0)
})

it('requires operational authority for initialization and refuses an unsafe empty assertion', async () => {
  const t = await tenant()
  const config = {
    ...input().services[0]!,
    estimationMode: 'active',
    resourceStateKnown: true,
  }
  expect(
    (
      await request(`/staff/queues/${t.queueId}`, t.sales.cookie, 'PATCH', {
        ...config,
        version: 0,
        open: true,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await request(
        `/staff/queues/${t.queueId}/opening-context`,
        t.sales.cookie,
      )
    ).status,
  ).toBe(404)
  expect(
    (
      await request(
        `/staff/queues/${t.queueId}/lifecycle`,
        t.sales.cookie,
        'POST',
        { action: 'close', contextToken: 'x' },
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(404)
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,2,'en',?,1,'called')",
  )
    .bind(id, t.queueId, id, 'hash', id, id, Date.now())
    .run()
  expect(
    (
      await request(`/staff/queues/${t.queueId}`, t.owner.cookie, 'PATCH', {
        ...config,
        version: 0,
        open: true,
      })
    ).status,
  ).toBe(409)
})

async function declareRestaurant(
  t: Awaited<ReturnType<typeof tenant>>,
  existingConfig?: Record<string, unknown>,
) {
  const stored = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(t.queueId)
    .first<{ config: string }>()
  const config = existingConfig ?? {
    ...JSON.parse(stored!.config),
    intelligencePolicy: 'disabled',
    spaces: [
      {
        id: 'legacy-0',
        name: 'Interior',
        tables: 10,
        tableTypes: [{ seats: 20, count: 10 }],
      },
    ],
  }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify(config), t.queueId)
    .run()
  const context = (await (
    await request(`/staff/queues/${t.queueId}/opening-context`, t.owner.cookie)
  ).json()) as { contextToken: string }
  const result = await request(
    `/staff/queues/${t.queueId}/lifecycle`,
    t.owner.cookie,
    'POST',
    { action: 'declare_full', contextToken: context.contextToken },
    crypto.randomUUID(),
  )
  expect(result.status, await result.clone().text()).toBe(200)
}

it('supplies the same provisional queue forecast to customers and staff when only configured context is available', async () => {
  const t = await tenant()
  await declareRestaurant(t)
  const coordinator = env.QUEUE_COORDINATOR.getByName(t.queueId)
  const joined = await coordinator.join(t.queueId, crypto.randomUUID(), {
    partySize: 2,
    locale: 'en',
    whatsapp: { consent: false },
  })
  expect(joined.status).toBe(201)
  expect(joined.body).toMatchObject({
    position: 1,
    etaMinutes: 30,
    predictedAt: expect.any(Number),
    estimateQuality: 'provisional',
  })
  const { readEntry } = await import('./features/queue/entries')
  const token = (joined.body as { recoveryToken: string }).recoveryToken
  const customer = await readEntry(env, token)
  expect(customer).toMatchObject({
    position: 1,
    etaMinutes: 30,
    predictedAt: expect.any(Number),
    estimateQuality: 'provisional',
  })
  const staff = await request(
    `/staff/queues/${t.queueId}/entries`,
    t.owner.cookie,
  )
  expect(((await staff.json()) as unknown[])[0]).toMatchObject({
    position: 1,
    etaMinutes: customer!.etaMinutes,
    predictedAt: customer!.predictedAt,
    estimateQuality: customer!.estimateQuality,
  })
})

it('keeps intelligent operation active despite legacy untracked turns', async () => {
  const t = await tenant()
  const config = {
    ...input().services[0]!,
    estimationMode: 'shadow',
    resourceStateKnown: true,
    spaces: [
      {
        id: 'room',
        name: 'Room',
        tables: 1,
        tableTypes: [{ seats: 2, count: 1, averageMinutes: 20 }],
      },
    ],
  }
  for (let i = 1; i <= 2; i++) {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence) VALUES (?,?,?,?,?,?,2,'en',?,?)",
    )
      .bind(id, t.queueId, id, 'hash', id, id, Date.now(), i)
      .run()
    // Legacy occupancy is fixture data, never created by a new unsafe assignment.
    await env.DB.prepare("UPDATE queue_entry SET status='called' WHERE id=?")
      .bind(id)
      .run()
  }
  await configureAndOpen(t, t.queueId, config)
  const context = await request(
    `/staff/queues/${t.queueId}/opening-context`,
    t.owner.cookie,
  )
  const current = (await context.json()) as { version: number }
  expect(
    (
      await request(`/staff/queues/${t.queueId}`, t.owner.cookie, 'PATCH', {
        ...config,
        estimationMode: 'active',
        version: current.version,
        open: true,
      })
    ).status,
  ).toBe(200)
})

async function configureAndOpen(
  t: Awaited<ReturnType<typeof tenant>>,
  queueId: string,
  config: Record<string, unknown>,
) {
  const result = await request(
    `/staff/queues/${queueId}`,
    t.owner.cookie,
    'PATCH',
    {
      ...config,
      estimationMode: 'shadow',
      resourceStateKnown: false,
      version: 0,
      open: false,
    },
  )
  expect(result.status, await result.clone().text()).toBe(200)
  const context = (await (
    await request(`/staff/queues/${queueId}/opening-context`, t.owner.cookie)
  ).json()) as import('@noqueue/contracts/staff').QueueOpeningContext
  if (!context.open) {
    const opened = await request(
      `/staff/queues/${queueId}/lifecycle`,
      t.owner.cookie,
      'POST',
      {
        action: 'open',
        contextToken: context.contextToken,
      },
      crypto.randomUUID(),
    )
    expect(opened.status, await opened.clone().text()).toBe(200)
  }
}

async function resourceFixture(
  spaces: unknown[],
  extra: Record<string, unknown> = {},
) {
  const t = await tenant()
  const config = {
    ...input().services[0]!,
    estimationMode: 'active',
    resourceStateKnown: true,
    spaces,
    ...extra,
  }
  await configureAndOpen(t, t.queueId, config)
  const add = async (sequence: number, size: number, status = 'waiting') => {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status) VALUES (?,?,?,?,?,?,?,'en',?,?,?)",
    )
      .bind(
        id,
        t.queueId,
        id,
        'hash',
        id,
        id,
        size,
        Date.now(),
        sequence,
        status,
      )
      .run()
    return id
  }
  const command = (id: string, action: string, version = 0) =>
    request(
      `/staff/queues/${t.queueId}/commands`,
      t.owner.cookie,
      'POST',
      { entryId: id, version, action },
      crypto.randomUUID(),
    )
  return { ...t, config, add, command }
}
it('calls a fallback party without overriding a preferred-space-only older party', async () => {
  const t = await resourceFixture(
    [
      {
        id: 'terrace',
        name: 'Terrace',
        tables: 1,
        tableTypes: [{ seats: 2, count: 1, averageMinutes: 20 }],
      },
      {
        id: 'salon',
        name: 'Salon',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
      },
    ],
    { assignmentPreference: 'terrace' },
  )
  const occupied = await t.add(1, 2, 'completed')
  await env.DB.prepare(
    "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at) VALUES (?,?,'terrace:2:0','terrace',2,?,?)",
  )
    .bind(occupied, t.queueId, Date.now() - 10 * 60000, Date.now() - 10 * 60000)
    .run()
  await t.add(2, 2)
  const fallback = await t.add(3, 4)
  expect((await t.command(fallback, 'call')).status).toBe(200)
})
it('evaluates actual call against the immutable first forecast, not call-time refresh', async () => {
  const t = await resourceFixture([
    {
      id: 'room',
      name: 'Room',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
    },
  ])
  const id = await t.add(1, 2)
  const { recalculateQueue } = await import('./features/queue/projection')
  const forecastAt = Date.now() - 10 * 60000
  await recalculateQueue(env, t.queueId, forecastAt)
  await recalculateQueue(env, t.queueId)
  expect((await t.command(id, 'call')).status).toBe(200)
  const evidence = await env.DB.prepare(
    'SELECT predicted_at,error_minutes FROM queue_wait_evidence WHERE entry_id=?',
  )
    .bind(id)
    .first<{ predicted_at: number; error_minutes: number }>()
  expect(evidence?.predicted_at).toBe(forecastAt + 20 * 60000)
  expect(evidence?.error_minutes).toBeLessThan(0)
})
it('ignores physical availability as a queue gate and retires legacy availability updates', async () => {
  const t = await resourceFixture(
    [
      {
        id: 'terrace',
        name: 'Terrace',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
      },
      {
        id: 'salon',
        name: 'Salon',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 30 }],
      },
    ],
    { assignmentPreference: 'terrace' },
  )
  const id = await t.add(1, 2)
  const current = await env.DB.prepare('SELECT version,open,config FROM queue WHERE id=?')
    .bind(t.queueId).first<{version:number;open:number;config:string}>()
  const deprecated = await request(`/staff/queues/${t.queueId}`, t.owner.cookie, 'PATCH', {
    ...JSON.parse(current!.config),
    adjustments: [{kind:'availability',spaceId:'terrace',seats:4,reason:'Legacy block',expiresAt:Date.now()+60000}],
    version:current!.version, open:!!current!.open,
  })
  expect(deprecated.status).toBe(410)
  expect((await t.command(id, 'call')).status).toBe(200)
  const second = await t.add(2, 4)
  expect((await t.command(second, 'call')).status).toBe(200)
  expect((await env.DB.prepare('SELECT * FROM queue_allocation WHERE queue_id=?').bind(t.queueId).all()).results).toHaveLength(0)
})
it('completes an arrival terminally and assigns another waiter without release or inventory changes', async () => {
  const t = await resourceFixture(
    [
      {
        id: 'room',
        name: 'Room',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 20 }],
      },
    ],
  )
  const id = await t.add(1, 2)
  expect((await t.command(id, 'call')).status).toBe(200)
  const read = await request(
    `/staff/queues/${t.queueId}/entries`,
    t.owner.cookie,
  )
  expect(read.status).toBe(200)
  expect((await t.command(id, 'complete', 1)).status).toBe(200)
  const second = await t.add(2, 2)
  expect((await t.command(second, 'call')).status).toBe(200)
  expect((await t.command(id, 'release', 2)).status).toBe(410)
  expect(
    (await env.DB.prepare('SELECT status FROM queue_entry WHERE id=?')
      .bind(second)
      .first<{ status: string }>())?.status,
  ).toBe('called')
  expect((await env.DB.prepare('SELECT * FROM queue_allocation WHERE queue_id=?').bind(t.queueId).all()).results).toHaveLength(0)
})

it('reports physical schedule independently of cutoff and legacy switch', async () => {
  const t = await tenant()
  const config = {
    ...input().services[0]!,
    twentyFourHours: false,
    cutoffMinutes: 15,
    schedules: [{ day: 1, from: '12:00', to: '15:00' }],
  }
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(JSON.stringify(config), t.queueId)
    .run()
  for (const [at, serviceOpen, blockReason] of [
    ['2026-09-21T10:00:00Z', true, 'inactive'],
    ['2026-09-21T12:45:00Z', true, 'cutoff'],
    ['2026-09-22T10:00:00Z', false, 'closed'],
  ] as const) {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(at))
    try {
      for (const enabled of [0, 1]) {
        await env.DB.prepare('UPDATE queue SET open=? WHERE id=?')
          .bind(enabled, t.queueId)
          .run()
        const result = await request(
          `/staff/venues/${t.venueId}/queues`,
          t.owner.cookie,
        )
        expect(result.status).toBe(200)
        expect(((await result.json()) as unknown[])[0]).toMatchObject({
          open: enabled,
          serviceOpen,
          outsideSchedule: !serviceOpen,
          queueState: 'inactive',
          canJoin: false,
          blockReason,
        })
      }
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  }
})

it('does not allow configuration-only creation to establish a manual operational opt-out', async () => {
  const t = await tenant(),
    service = { ...input().services[0]!, intelligencePolicy: 'disabled' }
  expect(
    (
      await request(
        `/staff/venues/${t.venueId}/queues`,
        t.sales.cookie,
        'POST',
        service,
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(400)
  await expect(
    provision(env, t.sales.id, crypto.randomUUID(), {
      ...input(),
      services: [{ ...input().services[0]!, intelligencePolicy: 'disabled' }],
    }),
  ).rejects.toThrow('operational_initialization_required')
})
it('keeps summaries read-only and does not restore an inventory gate on selected entries read', async () => {
  const t = await tenant()
  await configureAndOpen(t, t.queueId, {
    ...input().services[0]!,
    spaces: [
      {
        id: 'room',
        name: 'Room',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1 }],
      },
    ],
  })
  const stored = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(t.queueId)
    .first<{ config: string }>()
  await env.DB.prepare('UPDATE queue SET config=? WHERE id=?')
    .bind(
      JSON.stringify({
        ...JSON.parse(stored!.config),
        estimationMode: 'shadow',
      }),
      t.queueId,
    )
    .run()
  const inventory = await env.DB.prepare(
    'SELECT * FROM queue_opening WHERE queue_id=?',
  )
    .bind(t.queueId)
    .first()
  const result = await request(
    `/staff/venues/${t.venueId}/queues`,
    t.owner.cookie,
  )
  expect(result.status).toBe(200)
  const rows = (await result.json()) as {
    config: { estimationMode: string }
    readiness: { state: string }
  }[]
  expect(rows[0]?.readiness.state).toBe('active')
  expect(rows[0]?.config.estimationMode).toBe('shadow')
  expect(
    (await request(`/staff/queues/${t.queueId}/entries`, t.owner.cookie))
      .status,
  ).toBe(200)
  expect(
    JSON.parse(
      (await env.DB.prepare('SELECT config FROM queue WHERE id=?')
        .bind(t.queueId)
        .first<{ config: string }>())!.config,
    ).estimationMode,
  ).toBe('active')
  expect(
    await env.DB.prepare('SELECT * FROM queue_opening WHERE queue_id=?')
      .bind(t.queueId)
      .first(),
  ).toEqual(inventory)
})

it('exposes safe service metadata and handles scoped manual/public detailed joins', async () => {
  const t = await tenant(),
    viewer = await member(t, 'viewer')
  await declareRestaurant(t)
  const metadata = (await (
    await request(`/public/services/${t.queueId}`)
  ).json()) as { type: string; spaces: { id: string; name: string }[] }
  expect(metadata).toMatchObject({
    type: 'restaurant',
    spaces: [{ name: 'Interior' }],
  })
  expect(metadata).not.toHaveProperty('config')
  const payload = {
    displayName: 'María López',
    partySize: 2,
    locale: 'es',
    preferredSpaceId: metadata.spaces[0]!.id,
  }
  expect(
    (
      await request(
        `/staff/queues/${t.queueId}/entries`,
        viewer.cookie,
        'POST',
        payload,
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await request(
        `/staff/queues/${t.queueId}/entries`,
        t.sales.cookie,
        'POST',
        payload,
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(404)
  const key = crypto.randomUUID()
  const manual = await request(
    `/staff/queues/${t.queueId}/entries`,
    t.owner.cookie,
    'POST',
    payload,
    key,
  )
  expect(manual.status, await manual.clone().text()).toBe(201)
  const created =
    (await manual.json()) as import('@noqueue/contracts/queue').Entry
  expect(
    await (
      await request(
        `/staff/queues/${t.queueId}/entries`,
        t.owner.cookie,
        'POST',
        payload,
        key,
      )
    ).json(),
  ).toEqual({
    ...created,
    customer: { ...created.customer, serverNow: expect.any(Number) },
  })
  expect(
    (
      await request(
        `/staff/queues/${t.queueId}/entries`,
        t.owner.cookie,
        'POST',
        { ...payload, displayName: 'Different' },
        key,
      )
    ).status,
  ).toBe(409)
  const publicJoin = await request(
    `/public/services/${t.queueId}/entries`,
    '',
    'POST',
    { ...payload, displayName: 'Daniel' },
    crypto.randomUUID(),
  )
  expect(publicJoin.status).toBe(201)
  expect(
    (
      await request(
        `/public/services/${t.queueId}/entries`,
        '',
        'POST',
        { displayName: 'New Guest', partySize: 2, locale: 'es' },
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(201)
  const entries = (await (
    await request(`/staff/queues/${t.queueId}/entries`, t.owner.cookie)
  ).json()) as Record<string, unknown>[]
  expect(entries[0]).toMatchObject({
    displayName: 'María López',
    preferredSpaceId: metadata.spaces[0]!.id,
    space: { name: 'Interior', source: 'preferred' },
  })
  expect(entries[2]).toMatchObject({
    displayName: 'New Guest',
    receptionService: null,
    preferredSpaceId: null,
    space: null,
  })
  expect(JSON.stringify(entries)).not.toContain('displayNameCipher')
  expect(
    (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM queue_entry WHERE queue_id=?',
    )
      .bind(t.queueId)
      .first<{ n: number }>())!.n,
  ).toBe(3)
})

it('retires physical resource operations while preserving historical assignments and reading null-config entries', async () => {
  const t = await tenant()
  const raw = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
    .bind(t.queueId)
    .first<{ config: string }>()
  const config = {
    ...JSON.parse(raw!.config),
    resourceStateKnown: true,
    spaces: [
      {
        id: 'a',
        name: 'Wrong prefix',
        tables: 1,
        tableTypes: [{ seats: 2, count: 1 }],
      },
      {
        id: 'a:extra',
        name: 'Exact match',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1 }],
      },
    ],
  }
  await declareRestaurant(t, config)
  const context = (await (
    await request(`/staff/queues/${t.queueId}/opening-context`, t.owner.cookie)
  ).json()) as { contextToken: string }
  expect(
    (
      await request(
        `/staff/queues/${t.queueId}/lifecycle`,
        t.owner.cookie,
        'POST',
        {
          action: 'release_unit',
          spaceId: 'a:extra',
          seats: 4,
          contextToken: context.contextToken,
        },
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(410)
  const r = await request(
    `/public/services/${t.queueId}/entries`,
    '',
    'POST',
    { displayName: 'Guest', partySize: 4, locale: 'es' },
    crypto.randomUUID(),
  )
  expect(r.status).toBe(201)
  let rows = (await (
    await request(`/staff/queues/${t.queueId}/entries`, t.owner.cookie)
  ).json()) as {
    id: string
    space: { name: string; source: string } | null
  }[]
  expect(rows[0]!.space).toBeNull()
  await env.DB.batch([
    env.DB.prepare("UPDATE queue_entry SET status='served' WHERE id=?").bind(
      rows[0]!.id,
    ),
    env.DB.prepare(
      "INSERT INTO queue_allocation(entry_id,queue_id,resource_id,space_id,seats,reserved_at,arrived_at,released_at,outcome) VALUES (?,?,'a:extra:4:0','a:extra',4,1,2,3,'served')",
    ).bind(rows[0]!.id, t.queueId),
  ])
  rows = (await (
    await request(`/staff/queues/${t.queueId}/entries`, t.owner.cookie)
  ).json()) as typeof rows
  expect(rows[0]!.space).toBeNull()
  expect(
    await env.DB.prepare('SELECT space_id FROM queue_allocation WHERE entry_id=?')
      .bind(rows[0]!.id)
      .first(),
  ).toEqual({ space_id: 'a:extra' })
  await env.DB.prepare('UPDATE queue SET config=NULL WHERE id=?')
    .bind(t.queueId)
    .run()
  expect(
    (await request(`/staff/queues/${t.queueId}/entries`, t.owner.cookie))
      .status,
  ).toBe(200)
})

it.each(['whatsapp-queue-updates-v1', 'whatsapp-manual-queue-updates-v2'])('manual consent %s passes through the coordinator and durably queues encrypted contact exactly once', async (version) => {
  const t = await tenant()
  await declareRestaurant(t)
  const list = (await (
    await request(`/staff/venues/${t.venueId}/queues`, t.owner.cookie)
  ).json()) as Record<string, unknown>[]
  expect(list[0]).toHaveProperty('manualJoinWhatsappRequired', false)
  const payload = {
    displayName: 'Consented Client',
    partySize: 1,
    locale: 'en',
    whatsapp: {
      consent: true,
      phone: '+34600000000',
      version,
    },
  }
  const key = crypto.randomUUID()
  const create = () =>
    request(
      `/staff/queues/${t.queueId}/entries`,
      t.owner.cookie,
      'POST',
      payload,
      key,
    )
  expect((await create()).status).toBe(201)
  expect((await create()).status).toBe(200)
  const rows = await env.DB.prepare(
    `SELECT e.id,e.locale,p.phone_cipher,c.version,c.purpose,n.status FROM queue_entry e JOIN queue_entry_contact p ON p.entry_id=e.id JOIN consent c ON c.entry_id=e.id JOIN notification_outbox n ON n.entry_id=e.id WHERE e.queue_id=? AND n.kind='queue_joined'`,
  )
    .bind(t.queueId)
    .all<{
      id: string
      locale: string
      phone_cipher: string
      version: string
      purpose: string
      status: string
    }>()
  expect(rows.results).toHaveLength(1)
  expect(rows.results[0]).toMatchObject({
    version,
    locale: 'en',
    purpose: 'queue_updates',
    status: 'pending',
  })
  const { decryptPhone } = await import('./features/queue/crypto')
  expect(rows.results[0]!.phone_cipher).not.toContain('600000000')
  expect(
    await decryptPhone(env.PII_ENCRYPTION_KEY, rows.results[0]!.phone_cipher),
  ).toBe('+34600000000')
})

it('serves anonymous venue aggregates and protects token-bound commands, retries and suspension', async () => {
  const t = await tenant()
  await declareRestaurant(t)
  await env.DB.prepare('DELETE FROM staff_rate').run()
  const joined = await request(
    `/public/services/${t.queueId}/entries`,
    '',
    'POST',
    {
      displayName: 'Private Guest',
      partySize: 3,
      preferredSpaceId: 'fastest',
      locale: 'es',
    },
    crypto.randomUUID(),
  )
  expect(joined.status).toBe(201)
  const entry = (await joined.json()) as {
    recoveryToken: string
    customer: { version: number }
  }
  const venueResponse = await request(`/public/venues/${t.venueId}/services`)
  expect(venueResponse.headers.get('Cache-Control')).toBe('no-store')
  const venue = (await venueResponse.json()) as {
    services: { waitingPeople: number; waitingTurns: number; averageWaitMinutes: number | null }[]
  }
  expect(venue.services[0]?.waitingPeople).toBe(3)
  expect(venue.services[0]?.waitingTurns).toBe(1)
  const service = await (await request(`/public/services/${t.queueId}`)).json()
  expect(service).toMatchObject({ waitingPeople: 3, waitingTurns: 1 })
  expect(venue.services[0]?.averageWaitMinutes).toBe(30)
  expect(JSON.stringify(venue)).not.toContain('Private Guest')
  expect(JSON.stringify(venue)).not.toContain(entry.recoveryToken)
  const path = `/public/entries/${entry.recoveryToken}/commands`
  const command = { action: 'cancel', version: entry.customer.version },
    key = crypto.randomUUID()
  const forbidden = await app.request(
    `${origin}/api/v1${path}`,
    {
      method: 'POST',
      headers: {
        Origin: 'https://other.invalid',
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(command),
    },
    env,
  )
  expect(forbidden.status).toBe(403)
  expect(
    (
      await request(
        '/public/entries/' + 'a'.repeat(64) + '/commands',
        '',
        'POST',
        command,
        key,
      )
    ).status,
  ).toBe(404)
  expect(
    (
      await request(
        path,
        '',
        'POST',
        { ...command, entryId: 'another-entry' },
        key,
      )
    ).status,
  ).toBe(400)
  expect((await request(path, '', 'POST', command, key)).status).toBe(200)
  expect((await request(path, '', 'POST', command, key)).status).toBe(200)
  expect(
    (await request(path, '', 'POST', { action: 'yield', version: 0 }, key))
      .status,
  ).toBe(409)
  const snapshot = (await (
    await request(`/public/entries/${entry.recoveryToken}`)
  ).json()) as { status: string }
  expect(snapshot.status).toBe('cancelled')
  for (let i = 0; i < 31; i++) await request(path, '', 'POST', command, key)
  expect((await request(path, '', 'POST', command, key)).status).toBe(429)
  await env.DB.prepare('DELETE FROM staff_rate').run()
  await env.DB.prepare(
    "UPDATE tenant_account SET status='suspended' WHERE organization_id=?",
  )
    .bind(t.organizationId)
    .run()
  expect((await request(`/public/venues/${t.venueId}/services`)).status).toBe(
    404,
  )
  expect((await request(path, '', 'POST', command, key)).status).toBe(404)
})

it('authorizes address confirmation by server role and scope, rejects unsigned or mismatched selections', async () => {
  const t = await tenant(),
    otherSales = await identity('commercial_operator'),
    viewer = await member(t, 'viewer'),
    admin = await identity('platform_admin')
  const scope = { kind: 'venue', id: t.venueId }
  network.use(
    http.get('https://api.geoapify.com/v1/geocode/search', () =>
      HttpResponse.json({
        features: [
          {
            properties: {
              formatted: 'Calle Mayor 1 Madrid',
              street: 'Calle Mayor',
              city: 'Madrid',
              country_code: 'es',
              lat: 40.416,
              lon: -3.704,
              place_id: 'fixture',
              result_type: 'building',
            },
          },
        ],
      }),
    ),
  )
  for (const cookie of [t.sales.cookie, admin.cookie])
    expect(
      (
        await request('/staff/locations/resolve', cookie, 'POST', {
          text: 'Calle Mayor 1 Madrid',
          scope,
        })
      ).status,
    ).toBe(200)
  expect(
    (
      await request('/staff/locations/resolve', viewer.cookie, 'POST', {
        text: 'Calle Mayor 1 Madrid',
        scope,
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await request('/staff/locations/resolve', otherSales.cookie, 'POST', {
        text: 'Calle Mayor 1 Madrid',
        scope,
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await request('/staff/locations/resolve', '', 'POST', {
        text: 'Calle Mayor 1 Madrid',
        scope,
      })
    ).status,
  ).toBe(401)
  const selected = (await (
    await request('/staff/locations/resolve', t.sales.cookie, 'POST', {
      text: 'Calle Mayor 1 Madrid',
      scope,
    })
  ).json()) as { candidates: { token: string }[] }
  const token = selected.candidates[0]!.token
  expect(
    (
      await request(`/staff/venues/${t.venueId}`, t.owner.cookie, 'PATCH', {
        version: 1,
        locationToken: token,
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await request(`/staff/venues/${t.venueId}`, t.sales.cookie, 'PATCH', {
        version: 1,
        locationToken: token,
        latitude: 1,
        longitude: 1,
      })
    ).status,
  ).toBe(400)
  const saved = await request(
    `/staff/venues/${t.venueId}`,
    t.sales.cookie,
    'PATCH',
    { version: 1, locationToken: token },
  )
  expect(saved.status).toBe(200)
  expect((await saved.json()) as object).toMatchObject({ version: 2 })
  expect(
    (
      await request(`/staff/venues/${t.venueId}`, t.sales.cookie, 'PATCH', {
        version: 1,
        locationToken: token,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await request(`/staff/venues/${t.venueId}`, viewer.cookie, 'PATCH', {
        version: 2,
        locationToken: token,
      })
    ).status,
  ).toBe(403)
})
it('fails new provisioning without a location and does not store partial tenant data', async () => {
  const sales = await identity('commercial_operator'),
    data = input()
  const response = await request(
    '/staff/commercial/organizations',
    sales.cookie,
    'POST',
    data,
    crypto.randomUUID(),
  )
  expect(response.status).toBe(400)
  expect(
    await env.DB.prepare('SELECT id FROM organization WHERE slug=?')
      .bind(data.slug)
      .first(),
  ).toBeNull()
  await expect(
    provision(env, sales.id, crypto.randomUUID(), {
      ...data,
      locationToken: 'unsigned',
    }),
  ).rejects.toThrow('location_confirmation_invalid')
  expect(
    await env.DB.prepare('SELECT id FROM user WHERE username=?')
      .bind(data.ownerUsername)
      .first(),
  ).toBeNull()
})

it('service creation prepares a validated snapshot in the same transaction and failures leave no partial service', async () => {
  const t = await tenant()
  const created = await request(
    `/staff/venues/${t.venueId}/queues`,
    t.owner.cookie,
    'POST',
    { ...input().services[0]!, name: 'Directory service' },
    crypto.randomUUID(),
  )
  expect(created.status).toBe(201)
  const { id } = (await created.json()) as { id: string }
  const row = await env.DB.prepare(
    'SELECT q.config,d.source_config,d.normalized_config FROM queue q JOIN service_directory_config d ON d.queue_id=q.id WHERE q.id=?',
  )
    .bind(id)
    .first<{
      config: string
      source_config: string
      normalized_config: string
    }>()
  expect(row!.source_config).toBe(row!.config)
  expect(JSON.parse(row!.normalized_config)).toMatchObject({
    name: 'Directory service',
    type: 'restaurant',
  })
  const count = await env.DB.prepare(
    'SELECT count(*) n FROM queue WHERE venue_id=?',
  )
    .bind(t.venueId)
    .first('n')
  await env.DB.exec(
    "CREATE TRIGGER reject_directory BEFORE INSERT ON service_directory_config BEGIN SELECT RAISE(ABORT,'fixture snapshot failure'); END",
  )
  const failed = await request(
    `/staff/venues/${t.venueId}/queues`,
    t.owner.cookie,
    'POST',
    { ...input().services[0]!, name: 'Failed directory service' },
    crypto.randomUUID(),
  )
  expect(failed.status).toBe(503)
  expect(
    await env.DB.prepare('SELECT count(*) n FROM queue WHERE venue_id=?')
      .bind(t.venueId)
      .first('n'),
  ).toBe(count)
  await env.DB.exec('DROP TRIGGER reject_directory')
})

it('authenticated autocomplete keeps provider order, filters imprecise candidates and signs exact scope without writes', async () => {
  const sales = await identity('commercial_operator'),
    scope = { kind: 'provision' as const, id: crypto.randomUUID() }
  network.use(
    http.get(
      'https://api.geoapify.com/v1/geocode/autocomplete',
      ({ request: providerRequest }) => {
        const url = new URL(providerRequest.url)
        expect(url.searchParams.get('filter')).toBe('countrycode:es')
        expect(url.searchParams.get('lang')).toBe('es')
        expect(url.searchParams.get('limit')).toBe('5')
        expect(url.searchParams.get('format')).toBe('geojson')
        return HttpResponse.json({
          features: [
            { properties: { formatted: 'Madrid', result_type: 'city' } },
            ...['Second', 'First', 'Second'].map((name) => ({
              properties: {
                formatted: `${name} Madrid`,
                street: name,
                city: 'Madrid',
                country_code: 'es',
                lat: 40,
                lon: -3,
                result_type: 'street',
                place_id: name,
              },
            })),
          ],
        })
      },
    ),
  )
  const response = await request(
    '/staff/locations/autocomplete',
    sales.cookie,
    'POST',
    { text: 'Calle Madrid', scope },
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const result = (await response.json()) as {
    candidates: { token: string; location: { formatted: string } }[]
  }
  expect(result.candidates.map((c) => c.location.formatted)).toEqual([
    'Second Madrid',
    'First Madrid',
  ])
  const { readLocationToken } = await import('./features/staff/location')
  expect(
    (await readLocationToken(env, result.candidates[0]!.token, sales.id, scope))
      .formatted,
  ).toBe('Second Madrid')
  expect(
    (
      await request('/staff/locations/autocomplete', '', 'POST', {
        text: 'Calle Madrid',
        scope,
      })
    ).status,
  ).toBe(401)
  const user = await identity()
  expect(
    (
      await request('/staff/locations/autocomplete', user.cookie, 'POST', {
        text: 'Calle Madrid',
        scope,
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await request('/staff/locations/autocomplete', sales.cookie, 'POST', {
        text: 'abc',
        scope,
      })
    ).status,
  ).toBe(400)
})
it('resolve and autocomplete share thirty atomic queries per actor and return Retry-After', async () => {
  const sales = await identity('commercial_operator'),
    scope = { kind: 'provision', id: crypto.randomUUID() }
  network.use(
    http.get('https://api.geoapify.com/v1/geocode/:operation', () =>
      HttpResponse.json({ features: [] }),
    ),
  )
  const responses = await Promise.all(
    Array.from({ length: 31 }, (_, i) =>
      request(
        `/staff/locations/${i % 2 ? 'resolve' : 'autocomplete'}`,
        sales.cookie,
        'POST',
        { text: 'Calle Madrid', scope },
      ),
    ),
  )
  expect(responses.filter((r) => r.status === 200)).toHaveLength(30)
  const limited = responses.filter((r) => r.status === 429)
  expect(limited).toHaveLength(1)
  expect(Number(limited[0]!.headers.get('Retry-After'))).toBeGreaterThan(0)
})
it('scheduled quota cleanup does not delete the current geocode actor bucket', async () => {
  const actor = crypto.randomUUID(),
    bucket = Math.floor(Date.now() / 60000)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO staff_rate VALUES (?,30)').bind(
      `geocode:${actor}:${bucket}`,
    ),
    env.DB.prepare('INSERT INTO staff_rate VALUES (?,30)').bind(
      `geocode:${actor}:${bucket - 6}`,
    ),
    env.DB.prepare('INSERT INTO staff_rate VALUES (?,60)').bind(
      `${actor}:${bucket}`,
    ),
  ])
  const worker = (await import('./index')).default
  await worker.scheduled({} as ScheduledController, env)
  expect(
    await env.DB.prepare('SELECT count FROM staff_rate WHERE key=?')
      .bind(`geocode:${actor}:${bucket}`)
      .first('count'),
  ).toBe(30)
  expect(
    await env.DB.prepare('SELECT count FROM staff_rate WHERE key=?')
      .bind(`geocode:${actor}:${bucket - 6}`)
      .first(),
  ).toBeNull()
  expect(
    await env.DB.prepare('SELECT count FROM staff_rate WHERE key=?')
      .bind(`${actor}:${bucket}`)
      .first('count'),
  ).toBe(60)
})
it('autocomplete rejection paths keep privacy headers, reject origins and bound bodies', async () => {
  const sales = await identity('commercial_operator'),
    scope = { kind: 'provision', id: crypto.randomUUID() }
  for (const [expected, headers, body] of [
    [
      403,
      { Origin: 'https://external.invalid' },
      JSON.stringify({ text: 'Calle Madrid', scope }),
    ],
    [
      413,
      { Origin: origin },
      JSON.stringify({ text: 'x'.repeat(70000), scope }),
    ],
  ] as const) {
    const r = await app.request(
      `${origin}/api/v1/staff/locations/autocomplete`,
      {
        method: 'POST',
        headers: {
          ...headers,
          Cookie: sales.cookie,
          'Content-Type': 'application/json',
        },
        body,
      },
      env,
    )
    expect(r.status).toBe(expected)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  }
})

it.each(['owner', 'venue_manager', 'queue_staff', 'viewer'] as const)(
  'denies venue location writes and geocoding to membership %s without side effects or quotas',
  async (role) => {
    const t = await tenant()
    const actor = role === 'owner' ? t.owner : await member(t, role)
    const scope = { kind: 'venue' as const, id: t.venueId }
    const location = {
      formatted: 'Calle Nueva 2, Madrid',
      latitude: 40.416,
      longitude: -3.704,
      address: {
        street: 'Calle Nueva',
        houseNumber: '2',
        city: 'Madrid',
        countryCode: 'es' as const,
      },
      provider: 'geoapify' as const,
      providerId: 'old-valid-selection',
      attribution: [{ text: 'Geoapify', url: 'https://www.geoapify.com/' }],
    }
    const oldToken = await issueLocationToken(env, actor.id, scope, location)
    const provider = vi.fn(() => HttpResponse.json({ features: [] }))
    network.use(
      http.get('https://api.geoapify.com/v1/geocode/:operation', provider),
    )
    const before = await env.DB.prepare('SELECT * FROM venue WHERE id=?')
      .bind(t.venueId)
      .first()
    const audits = await env.DB.prepare(
      'SELECT COUNT(*) n FROM staff_audit WHERE venue_id=?',
    )
      .bind(t.venueId)
      .first('n')
    const rates = (
      await env.DB.prepare(
        'SELECT * FROM staff_rate WHERE key LIKE ? OR key LIKE ? ORDER BY key',
      )
        .bind(actor.id + ':%', 'geocode:' + actor.id + ':%')
        .all()
    ).results
    for (const route of ['resolve', 'autocomplete']) {
      const response = await request(
        '/staff/locations/' + route,
        actor.cookie,
        'POST',
        { text: 'Calle Nueva 2 Madrid', scope },
      )
      expect(response.status).toBe(403)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    for (const token of [oldToken.token, 'invalid'])
      expect(
        (
          await request('/staff/venues/' + t.venueId, actor.cookie, 'PATCH', {
            version: 1,
            locationToken: token,
          })
        ).status,
      ).toBe(403)
    expect(provider).not.toHaveBeenCalled()
    expect(
      await env.DB.prepare('SELECT * FROM venue WHERE id=?')
        .bind(t.venueId)
        .first(),
    ).toEqual(before)
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) n FROM staff_audit WHERE venue_id=?',
      )
        .bind(t.venueId)
        .first('n'),
    ).toBe(audits)
    expect(
      (
        await env.DB.prepare(
          'SELECT * FROM staff_rate WHERE key LIKE ? OR key LIKE ? ORDER BY key',
        )
          .bind(actor.id + ':%', 'geocode:' + actor.id + ':%')
          .all()
      ).results,
    ).toEqual(rates)
    expect(
      (await request('/staff/venues/' + t.venueId + '/location', actor.cookie))
        .status,
    ).toBe(200)
    if (role === 'owner' || role === 'venue_manager') {
      const config = (await (
        await request('/staff/venues/' + t.venueId + '/queues', actor.cookie)
      ).json()) as { version: number; config: object }[]
      const response = await request(
        '/staff/queues/' + t.queueId,
        actor.cookie,
        'PATCH',
        { ...config[0]!.config, version: config[0]!.version, open: false },
      )
      expect(response.status).toBe(200)
    }
  },
)

it('restricts both geocoders and location saves to global commercial ownership or platform administration', async () => {
  const t = await tenant(),
    other = await identity('commercial_operator'),
    admin = await identity('platform_admin')
  // A global commercial operator's venue membership must not bypass client ownership.
  const memberSales = await member(t, 'venue_manager')
  await env.DB.prepare("UPDATE user SET role='commercial_operator' WHERE id=?")
    .bind(memberSales.id)
    .run()
  network.use(
    http.get('https://api.geoapify.com/v1/geocode/:operation', () =>
      HttpResponse.json({
        features: [
          {
            properties: {
              formatted: 'Calle Dos 2 Madrid',
              street: 'Calle Dos',
              city: 'Madrid',
              country_code: 'es',
              lat: 40.416,
              lon: -3.704,
              place_id: 'new',
              result_type: 'building',
            },
          },
        ],
      }),
    ),
  )
  for (const actor of [other, memberSales]) {
    for (const venueId of [t.venueId, crypto.randomUUID()]) {
      for (const route of ['resolve', 'autocomplete'])
        expect(
          (
            await request('/staff/locations/' + route, actor.cookie, 'POST', {
              text: 'Calle Dos 2 Madrid',
              scope: { kind: 'venue', id: venueId },
            })
          ).status,
        ).toBe(404)
      expect(
        (
          await request('/staff/venues/' + venueId, actor.cookie, 'PATCH', {
            version: 1,
            locationToken: 'invalid',
          })
        ).status,
      ).toBe(404)
    }
  }
  for (const actor of [t.sales, admin]) {
    let token = ''
    for (const route of ['resolve', 'autocomplete']) {
      const response = await request(
        '/staff/locations/' + route,
        actor.cookie,
        'POST',
        {
          text: 'Calle Dos 2 Madrid',
          scope: { kind: 'venue', id: t.venueId },
        },
      )
      expect(response.status).toBe(200)
      token = ((await response.json()) as { candidates: { token: string }[] })
        .candidates[0]!.token
    }
    const version = await env.DB.prepare('SELECT version FROM venue WHERE id=?')
      .bind(t.venueId)
      .first<number>('version')
    const response = await request(
      '/staff/venues/' + t.venueId,
      actor.cookie,
      'PATCH',
      { version, locationToken: token },
    )
    expect(response.status).toBe(200)
    expect((await response.json()) as object).toMatchObject({
      version: version! + 1,
      location: { formatted: 'Calle Dos 2 Madrid' },
    })
  }
  await env.DB.prepare(
    "UPDATE tenant_account SET status='suspended' WHERE organization_id=?",
  )
    .bind(t.organizationId)
    .run()
  expect(
    (await request('/staff/venues/' + t.venueId + '/location', t.owner.cookie))
      .status,
  ).toBe(404)
  // Existing commercial/platform suspended-tenant maintenance access is unchanged.
  for (const actor of [t.sales, admin])
    expect(
      (
        await request('/staff/locations/autocomplete', actor.cookie, 'POST', {
          text: 'Calle Dos 2 Madrid',
          scope: { kind: 'venue', id: t.venueId },
        })
      ).status,
    ).toBe(200)
})

describe('scoped staff identity details', () => {
  it('edits identity and role atomically, preserves credentials/access and revokes renamed sessions', async () => {
    const t = await tenant(),
      staff = await member(t),
      next = username()
    const path = `/staff/venues/${t.venueId}/members/${staff.id}/details`
    const before = await env.DB.prepare(
      "SELECT password FROM account WHERE userId=? AND providerId='credential'",
    )
      .bind(staff.id)
      .first()
    const rows = await request(
      `/staff/venues/${t.venueId}/members`,
      t.owner.cookie,
    )
    expect(
      (
        (await rows.json()) as {
          members: { id: string; canEditDetails: boolean }[]
        }
      ).members.find((m) => m.id === staff.id)?.canEditDetails,
    ).toBe(true)
    expect(
      (
        await request(path, t.owner.cookie, 'PATCH', {
          name: 'Updated Staff',
          username: next.toUpperCase(),
          role: 'viewer',
        })
      ).status,
    ).toBe(200)
    expect(
      await env.DB.prepare(
        'SELECT name,username,displayUsername FROM user WHERE id=?',
      )
        .bind(staff.id)
        .first(),
    ).toEqual({
      name: 'Updated Staff',
      username: next,
      displayUsername: next,
    })
    expect(
      await env.DB.prepare(
        'SELECT role,active FROM venue_membership WHERE user_id=? AND venue_id=?',
      )
        .bind(staff.id, t.venueId)
        .first(),
    ).toEqual({ role: 'viewer', active: 1 })
    expect(
      await env.DB.prepare(
        "SELECT password FROM account WHERE userId=? AND providerId='credential'",
      )
        .bind(staff.id)
        .first(),
    ).toEqual(before)
    expect((await request('/staff/me', staff.cookie)).status).toBe(401)
    expect(
      (
        await request('/auth/sign-in/username', '', 'POST', {
          username: staff.username,
          password,
        })
      ).status,
    ).not.toBe(200)
    await login(next)
    expect(
      await env.DB.prepare(
        "SELECT action FROM staff_audit WHERE target_id=? AND action='member.details_updated'",
      )
        .bind(staff.id)
        .first(),
    ).toBeTruthy()
  })
  it('rejects owner, self, global, shared identities and duplicate usernames without partial changes', async () => {
    const t = await tenant(),
      staff = await member(t),
      other = await member(t),
      outsider = await identity()
    const path = `/staff/venues/${t.venueId}/members/${staff.id}/details`
    const values = {
      name: 'Changed',
      username: other.username,
      role: 'viewer',
    }
    expect((await request(path, t.owner.cookie, 'PATCH', values)).status).toBe(
      409,
    )
    expect((await request(path, outsider.cookie, 'PATCH', values)).status).toBe(
      404,
    )
    expect(
      (
        await request(
          `/staff/venues/${t.venueId}/members/${t.owner.id}/details`,
          t.owner.cookie,
          'PATCH',
          values,
        )
      ).status,
    ).toBe(403)
    await env.DB.prepare(
      "UPDATE user SET role='commercial_operator' WHERE id=?",
    )
      .bind(staff.id)
      .run()
    expect(
      (
        await request(path, t.owner.cookie, 'PATCH', {
          ...values,
          username: username(),
        })
      ).status,
    ).toBe(403)
    await env.DB.prepare("UPDATE user SET role='user' WHERE id=?")
      .bind(staff.id)
      .run()
    const second = await tenant()
    await env.DB.prepare(
      "INSERT INTO venue_membership(user_id,venue_id,role,active) VALUES (?,?,'viewer',0)",
    )
      .bind(staff.id, second.venueId)
      .run()
    expect(
      (
        await request(path, t.owner.cookie, 'PATCH', {
          ...values,
          username: username(),
        })
      ).status,
    ).toBe(403)
    expect(
      await env.DB.prepare('SELECT name,username FROM user WHERE id=?')
        .bind(staff.id)
        .first(),
    ).toEqual({ name: 'Staff', username: staff.username })
  })
})

describe('member detail transactions', () => {
  it('preserves revoked access and sessions for name/role-only edits and hides shared grants', async () => {
    const t = await tenant(),
      staff = await member(t)
    await env.DB.prepare(
      'UPDATE venue_membership SET active=0 WHERE user_id=? AND venue_id=?',
    )
      .bind(staff.id, t.venueId)
      .run()
    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM session WHERE userId=?',
    )
      .bind(staff.id)
      .first()
    expect(
      (
        await request(
          `/staff/venues/${t.venueId}/members/${staff.id}/details`,
          t.owner.cookie,
          'PATCH',
          { name: 'Renamed', username: staff.username, role: 'viewer' },
        )
      ).status,
    ).toBe(200)
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?')
        .bind(staff.id)
        .first(),
    ).toEqual(before)
    expect(
      await env.DB.prepare(
        'SELECT active FROM venue_membership WHERE user_id=? AND venue_id=?',
      )
        .bind(staff.id, t.venueId)
        .first(),
    ).toEqual({ active: 0 })
    const second = await tenant()
    await env.DB.prepare(
      "INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,'member',?)",
    )
      .bind(
        crypto.randomUUID(),
        second.organizationId,
        staff.id,
        new Date().toISOString(),
      )
      .run()
    const response = await request(
      `/staff/venues/${t.venueId}/members`,
      t.owner.cookie,
    )
    const data = (await response.json()) as {
      members: { id: string; canEditDetails: boolean }[]
    }
    expect(data.members.find((m) => m.id === staff.id)?.canEditDetails).toBe(
      false,
    )
    expect(data.members.find((m) => m.id === t.owner.id)?.canEditDetails).toBe(
      false,
    )
    expect(
      (
        await request(
          `/staff/venues/${t.venueId}/members/${staff.id}/details`,
          t.owner.cookie,
          'PATCH',
          {
            name: 'Changed',
            username: username(),
            role: 'queue_staff',
            queueIds: [t.queueId],
          },
        )
      ).status,
    ).toBe(403)
  })
  it('rolls back identity, session deletion and audit when a later write fails', async () => {
    const t = await tenant(),
      staff = await member(t)
    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM session WHERE userId=?',
    )
      .bind(staff.id)
      .first()
    await env.DB.prepare(
      "CREATE TRIGGER reject_details_role BEFORE UPDATE OF role ON venue_membership BEGIN SELECT RAISE(ABORT,'fixture role failure'); END",
    ).run()
    try {
      expect(
        (
          await request(
            `/staff/venues/${t.venueId}/members/${staff.id}/details`,
            t.owner.cookie,
            'PATCH',
            { name: 'Changed', username: username(), role: 'viewer' },
          )
        ).status,
      ).toBe(503)
      expect(
        await env.DB.prepare('SELECT name,username FROM user WHERE id=?')
          .bind(staff.id)
          .first(),
      ).toEqual({ name: 'Staff', username: staff.username })
      expect(
        await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?')
          .bind(staff.id)
          .first(),
      ).toEqual(before)
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM staff_audit WHERE target_id=? AND action='member.details_updated'",
        )
          .bind(staff.id)
          .first(),
      ).toEqual({ n: 0 })
      expect(
        await env.DB.prepare(
          'SELECT role FROM venue_membership WHERE user_id=? AND venue_id=?',
        )
          .bind(staff.id, t.venueId)
          .first(),
      ).toEqual({ role: 'queue_staff' })
    } finally {
      await env.DB.prepare('DROP TRIGGER reject_details_role').run()
    }
  })
})

it('revokes sessions when assigning the first username to eligible staff', async () => {
  const t = await tenant(),
    staff = await member(t),
    next = username()
  await env.DB.prepare(
    'UPDATE user SET username=NULL,displayUsername=NULL WHERE id=?',
  )
    .bind(staff.id)
    .run()
  const listing = await request(
    `/staff/venues/${t.venueId}/members`,
    t.owner.cookie,
  )
  expect(
    (
      (await listing.json()) as {
        members: { id: string; username: string }[]
      }
    ).members.find((m) => m.id === staff.id)?.username,
  ).toBe('')
  expect(
    (
      await request(
        `/staff/venues/${t.venueId}/members/${staff.id}/details`,
        t.owner.cookie,
        'PATCH',
        {
          name: 'Staff',
          username: next,
          role: 'queue_staff',
          queueIds: [t.queueId],
        },
      )
    ).status,
  ).toBe(200)
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?')
      .bind(staff.id)
      .first(),
  ).toEqual({ n: 0 })
  await login(next)
})

it('rejects an exclusive venue grant whose organization membership belongs to another tenant', async () => {
  const t = await tenant(),
    staff = await member(t),
    other = await tenant()
  await env.DB.prepare('DELETE FROM staff_queue_assignment WHERE user_id=?')
    .bind(staff.id)
    .run()
  await env.DB.prepare(
    'UPDATE venue_membership SET venue_id=? WHERE user_id=? AND venue_id=?',
  )
    .bind(other.venueId, staff.id, t.venueId)
    .run()
  const listing = await request(
    `/staff/venues/${other.venueId}/members`,
    other.owner.cookie,
  )
  expect(
    (
      (await listing.json()) as {
        members: { id: string; canEditDetails: boolean }[]
      }
    ).members.find((m) => m.id === staff.id)?.canEditDetails,
  ).toBe(false)
  expect(
    (
      await request(
        `/staff/venues/${other.venueId}/members/${staff.id}/details`,
        other.owner.cookie,
        'PATCH',
        { name: 'Changed', username: username(), role: 'viewer' },
      )
    ).status,
  ).toBe(403)
})

it.each(['reception', 'pool'] as const)(
  'validates public %s admission while retaining single-person recovery',
  async (type) => {
    await env.DB.prepare('DELETE FROM staff_rate').run()
    const t = await tenant()
    const config = {
      ...input().services[0]!,
      type,
      capacity: 2,
      spaces: [],
      receptionServices: ['check_in' as const],
    }
    const created = await request(
      `/staff/venues/${t.venueId}/queues`,
      t.owner.cookie,
      'POST',
      config,
      crypto.randomUUID(),
    )
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    await configureAndOpen(t, id, config)
    const path = `/public/services/${id}/entries`
    const valid = {
      displayName: 'Guest',
      partySize: 1,
      locale: 'en',
      ...(type === 'reception' ? { receptionService: 'check_in' } : {}),
    }
    for (const body of [
      { ...valid, displayName: undefined },
      { ...valid, displayName: '   ' },
      ...(type === 'pool'
        ? [{ ...valid, partySize: 2 }]
        : [
            { ...valid, receptionService: undefined },
            { ...valid, receptionService: 'check_out' },
          ]),
    ]) {
      expect(
        (await request(path, '', 'POST', body, crypto.randomUUID())).status,
      ).toBe(400)
    }
    const key = crypto.randomUUID()
    const joined = await request(path, '', 'POST', valid, key)
    expect(joined.status).toBe(201)
    const body = (await joined.json()) as {
      recoveryToken: string
      customer: { partySize: number; actions: string[] }
    }
    expect(body.customer.partySize).toBe(1)
    expect(body.customer.actions).toEqual(['cancel', 'yield'])
    expect((await request(path, '', 'POST', valid, key)).status).toBe(200)
    expect(
      (await request(path, '', 'POST', valid, crypto.randomUUID())).status,
    ).toBe(201)
    if (type === 'pool')
      expect(
        (await request(path, '', 'POST', valid, crypto.randomUUID())).status,
      ).toBe(409)
    await env.DB.prepare(
      "UPDATE queue SET config=json_set(config,'$.receptionServices',json('[\"check_out\"]')) WHERE id=?",
    )
      .bind(id)
      .run()
    expect((await request(path, '', 'POST', valid, key)).status).toBe(200)
  },
)

it.each(['reception', 'pool'] as const)(
  'recovers a committed nameless %s request before enforcing new public admission',
  async (type) => {
    await env.DB.prepare('DELETE FROM staff_rate').run()
    const t = await tenant()
    const config = {
      ...input().services[0]!,
      type,
      spaces: [],
      receptionServices: ['check_in' as const],
    }
    const created = await request(
      `/staff/venues/${t.venueId}/queues`,
      t.owner.cookie,
      'POST',
      config,
      crypto.randomUUID(),
    )
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    await configureAndOpen(t, id, config)
    const { serviceJoinSchema } = await import('@noqueue/contracts/queue')
    const { joinQueue } = await import('./features/queue/entries')
    const payload = serviceJoinSchema.parse({
      partySize: type === 'pool' ? 2 : 1,
      locale: 'en',
    })
    const key = crypto.randomUUID()
    // The old public route forwarded exactly this normalized input, without a name.
    const committed = await joinQueue(env, id, key, {
      ...payload,
      whatsapp: { consent: false },
    })
    expect(committed.status).toBe(201)
    const original = await env.DB.prepare(
      'SELECT id,request_hash,recovery_hash,party_size,display_name_cipher FROM queue_entry WHERE queue_id=? AND idempotency_key=?',
    )
      .bind(id, key)
      .first()
    expect(original).toMatchObject({
      party_size: type === 'pool' ? 2 : 1,
      display_name_cipher: null,
    })
    const path = `/public/services/${id}/entries`
    const replay = await request(path, '', 'POST', payload, key)
    expect(replay.status).toBe(200)
    expect(
      ((await replay.json()) as { recoveryToken: string }).recoveryToken,
    ).toBe((committed.body as { recoveryToken: string }).recoveryToken)
    expect(
      await env.DB.prepare(
        'SELECT id,request_hash,recovery_hash,party_size,display_name_cipher FROM queue_entry WHERE queue_id=? AND idempotency_key=?',
      )
        .bind(id, key)
        .first(),
    ).toEqual(original)
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM queue_entry WHERE queue_id=?',
      )
        .bind(id)
        .first(),
    ).toEqual({ count: 1 })
    expect(
      (await request(path, '', 'POST', payload, crypto.randomUUID())).status,
    ).toBe(400)
    expect(
      (
        await request(
          path,
          '',
          'POST',
          { ...payload, displayName: 'Changed' },
          key,
        )
      ).status,
    ).toBe(409)
  },
)

it('filters establishments before pagination and exposes venue metadata', async () => {
  const t = await tenant()
  await env.DB.prepare('UPDATE venue SET name=? WHERE id=?')
    .bind('Literal %_ Hotel', t.venueId)
    .run()
  const list = async (query: string) =>
    (
      await request('/staff/commercial/organizations?' + query, t.sales.cookie)
    ).json() as Promise<{
      items: {
        venueId: string
        serviceCount: number
        configurationUpdatedAt: number | null
      }[]
    }>
  const matching = await list('q=%25_&status=active')
  expect(matching.items).toHaveLength(1)
  expect(matching.items[0]).toMatchObject({
    venueId: t.venueId,
    serviceCount: 1,
    configurationUpdatedAt: expect.any(Number),
  })
  expect((await list('q=absent')).items).toHaveLength(0)
  expect((await list('status=suspended')).items).toHaveLength(0)
})

it('touches all and only company venues on real status changes and keeps legacy dates unknown', async () => {
  const t = await tenant(),
    another = await tenant()
  const second = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
  )
    .bind(second, t.organizationId, 'Legacy second')
    .run()
  const stamp = (id: string) =>
    env.DB.prepare('SELECT configuration_updated_at FROM venue WHERE id=?')
      .bind(id)
      .first('configuration_updated_at')
  expect(await stamp(second)).toBeNull()
  const otherStamp = await stamp(another.venueId)
  const path = `/staff/commercial/organizations/${t.organizationId}/status`
  expect(
    (await request(path, t.sales.cookie, 'PATCH', { status: 'active' })).status,
  ).toBe(200)
  expect(await stamp(second)).toBeNull()
  expect(
    (await request(path, t.sales.cookie, 'PATCH', { status: 'suspended' }))
      .status,
  ).toBe(200)
  expect(await stamp(second)).toEqual(expect.any(Number))
  expect(await stamp(second)).toBe(await stamp(t.venueId))
  expect(await stamp(another.venueId)).toBe(otherStamp)
  const saved = await stamp(second)
  expect(
    (await request(path, t.sales.cookie, 'PATCH', { status: 'suspended' }))
      .status,
  ).toBe(200)
  expect(await stamp(second)).toBe(saved)
  const list = await request(
    '/staff/commercial/organizations?status=suspended',
    t.sales.cookie,
  )
  expect(
    (
      (await list.json()) as {
        items: { venueId: string; serviceCount: number }[]
      }
    ).items,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ venueId: second, serviceCount: 0 }),
      expect.objectContaining({ venueId: t.venueId, serviceCount: 1 }),
    ]),
  )
  const before = await stamp(t.venueId)
  expect(
    (
      await request(
        `/staff/venues/${t.venueId}/queues`,
        t.owner.cookie,
        'POST',
        input().services[0],
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(404)
  expect(await stamp(t.venueId)).toBe(before)
})

it('applies literal company/venue filters globally before the 24-row page boundary', async () => {
  const t = await tenant()
  const ids = Array.from(
    { length: 30 },
    (_, i) => `${t.venueId}-filtered-${String(i).padStart(2, '0')}`,
  )
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(
        'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
      ).bind(id, t.organizationId, 'Unique filtered %_ venue'),
    ),
  )
  const read = async (query: string, cookie = t.sales.cookie) =>
    (
      await request('/staff/commercial/organizations?' + query, cookie)
    ).json() as Promise<{
      items: {
        venueId: string
        serviceCount: number
        configurationUpdatedAt: number | null
      }[]
      hasMore: boolean
    }>
  const first = await read('q=Unique+filtered+%25_&status=active&page=1')
  const second = await read('q=Unique+filtered+%25_&status=active&page=2')
  expect(first.items).toHaveLength(24)
  expect(first.hasMore).toBe(true)
  expect(second.items).toHaveLength(6)
  expect(second.hasMore).toBe(false)
  expect(
    new Set([...first.items, ...second.items].map((v) => v.venueId)).size,
  ).toBe(30)
  expect(
    first.items.every(
      (v) => v.serviceCount === 0 && v.configurationUpdatedAt === null,
    ),
  ).toBe(true)
  expect(
    (await read('q=Unique+filtered+%25_&status=suspended')).items,
  ).toHaveLength(0)
  const other = await identity('commercial_operator')
  expect(
    (await read('q=Unique+filtered+%25_', other.cookie)).items,
  ).toHaveLength(0)
  const admin = await identity('platform_admin')
  expect(
    (await read('q=Unique+filtered+%25_', admin.cookie)).items,
  ).toHaveLength(24)
  expect(
    (
      await request(
        '/staff/commercial/organizations?status=closed',
        t.sales.cookie,
      )
    ).status,
  ).toBe(400)
})
it('timestamps added services and counts closed services without per-card reads', async () => {
  const t = await tenant()
  await env.DB.prepare(
    'UPDATE venue SET configuration_updated_at=100 WHERE id=?',
  )
    .bind(t.venueId)
    .run()
  const key = crypto.randomUUID(),
    body = input().services[0]
  const path = `/staff/venues/${t.venueId}/queues`
  expect((await request(path, t.owner.cookie, 'POST', body, key)).status).toBe(
    201,
  )
  const stamp = () =>
    env.DB.prepare('SELECT configuration_updated_at FROM venue WHERE id=?')
      .bind(t.venueId)
      .first('configuration_updated_at')
  expect(await stamp()).not.toBe(100)
  const saved = await stamp()
  expect((await request(path, t.owner.cookie, 'POST', body, key)).status).toBe(
    200,
  )
  expect(await stamp()).toBe(saved)
  const list = await request('/staff/commercial/organizations', t.sales.cookie)
  expect(((await list.json()) as { items: object[] }).items).toEqual([
    expect.objectContaining({ venueId: t.venueId, serviceCount: 2 }),
  ])
  expect(
    (await request(path, t.owner.cookie, 'POST', { ...body, name: 'Bad' }, key))
      .status,
  ).toBe(409)
  expect(await stamp()).toBe(saved)
})
it('keeps staff summary refreshes read-only at 10x queue count and counts 501 waiting turns beyond the entry page', async () => {
  const { profileD1 } = await import('../test/d1-profile')
  const t = await tenant()
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<501)
    INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,status,service_window_id)
    SELECT ?||':'||i,?,?||':'||i,'hash',?||':'||i,?||':'||i,3,'en',0,i,'waiting','continuous:test' FROM n`,
  )
    .bind(t.queueId, t.queueId, t.queueId, t.queueId, t.queueId)
    .run()
  const measured = profileD1(env),
    getByName = vi.fn(() => {
      throw new Error('Summary must not refresh coordinators')
    })
  const bindings = {
    ...measured.env,
    QUEUE_COORDINATOR: {
      ...env.QUEUE_COORDINATOR,
      getByName,
      jurisdiction: () => ({ getByName }),
    },
  } as unknown as typeof env
  const read = () =>
    app.request(
      `${origin}/api/v1/staff/venues/${t.venueId}/queues`,
      { headers: { Cookie: t.owner.cookie } },
      bindings,
    )
  const costs = []
  for (const queues of [1, 10]) {
    if (queues === 10)
      await env.DB.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9)
      INSERT INTO queue(id,venue_id,name,capacity,average_minutes,open,config)
      SELECT q.id||':copy:'||i,q.venue_id,q.name,q.capacity,q.average_minutes,q.open,q.config FROM queue q,n WHERE q.id=?`,
      )
        .bind(t.queueId)
        .run()
    measured.costs.length = 0
    const response = await read()
    expect(response.status).toBe(200)
    const rows = (await response.json()) as {
      id: string
      waitingCount: number
    }[]
    expect(rows).toHaveLength(queues)
    expect(rows.find((row) => row.id === t.queueId)?.waitingCount).toBe(501)
    expect(getByName).not.toHaveBeenCalled()
    expect(
      measured.costs.some((cost) => /INSERT|UPDATE|DELETE/.test(cost.sql)),
    ).toBe(false)
    const summary = measured.costs.find((cost) =>
      cost.sql.includes('AS waitingCount'),
    )!
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${summary.sql}`)
      .bind(t.venueId, 'owner', t.owner.id)
      .all<{ detail: string }>()
    expect(
      plan.results.some((row) => row.detail.includes('queue_venue_lookup')),
    ).toBe(true)
    expect(
      plan.results.some((row) =>
        row.detail.includes('queue_entry_status_sequence'),
      ),
    ).toBe(true)
    costs.push({
      queues,
      statements: measured.costs.length,
      rowsRead: measured.costs.reduce(
        (total, cost) => total + cost.rowsRead,
        0,
      ),
    })
  }
  console.info({ event: 'local_staff_summary_read_cost', costs })
  expect(costs[1]!.statements).toBeLessThan(costs[0]!.statements * 10)
  expect(costs[1]!.rowsRead).toBeLessThan(costs[0]!.rowsRead * 10)
})

describe('auth initialization reuse without cached authorization', () => {
  const schemaReads = (costs: Array<{ sql: string }>) =>
    costs.filter(({ sql }) => /sqlite_master|pragma_table_info/i.test(sql))
  const sessionReads = (costs: Array<{ sql: string }>) =>
    costs.filter(({ sql }) => /select.*[" ]session[" ]/i.test(sql))
  const read = (bindings: typeof env, cookie: string, path = '/staff/me') =>
    app.request(
      `${origin}/api/v1${path}`,
      { headers: { Cookie: cookie } },
      { ...bindings },
    )

  it('validates cold auth once and keeps warm authenticated summary requests free of schema rescans', async () => {
    const t = await tenant(),
      measured = profileD1(env)
    const path = `/staff/venues/${t.venueId}/queues`
    expect((await read(measured.env, t.owner.cookie, path)).status).toBe(200)
    const cold = [...measured.costs]
    expect(cold.some(({ sql }) => /sqlite_master/i.test(sql))).toBe(true)
    expect(cold.some(({ sql }) => /pragma_table_info/i.test(sql))).toBe(true)
    const warm = []
    for (let i = 0; i < 3; i++) {
      measured.costs.length = 0
      expect((await read(measured.env, t.owner.cookie, path)).status).toBe(200)
      warm.push([...measured.costs])
      expect(sessionReads(measured.costs)).not.toHaveLength(0)
    }
    const summarize = (costs: typeof measured.costs) => ({
      statements: costs.length,
      rowsRead: costs.reduce((total, cost) => total + cost.rowsRead, 0),
      schemaStatements: schemaReads(costs).length,
    })
    console.info({
      event: 'local_auth_initialization_read_cost',
      cold: summarize(cold),
      warm: warm.map(summarize),
    })
    expect(warm.map((costs) => schemaReads(costs).length)).toEqual([0, 0, 0])
  })

  it('shares the cold schema check across concurrent authenticated requests', async () => {
    const user = await identity(),
      measured = profileD1(env)
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => read(measured.env, user.cookie)),
    )
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200,
    ])
    expect(
      measured.costs.filter(({ sql }) => /sqlite_master/i.test(sql)),
    ).toHaveLength(1)
    expect(sessionReads(measured.costs)).toHaveLength(5)
  })

  it('keeps initialization and sessions isolated between actual local databases', async () => {
    const user = await identity(),
      first = profileD1(env)
    const isolation = (env as typeof env & { AUTH_ISOLATION_DB: D1Database })
      .AUTH_ISOLATION_DB
    await applyD1Migrations(isolation, env.TEST_MIGRATIONS)
    const second = profileD1({ ...env, DB: isolation })
    expect((await read(first.env, user.cookie)).status).toBe(200)
    expect((await read(second.env, user.cookie)).status).toBe(401)
    expect(schemaReads(first.costs).length).toBeGreaterThan(0)
    expect(schemaReads(second.costs).length).toBeGreaterThan(0)
    first.costs.length = second.costs.length = 0
    expect((await read(first.env, user.cookie)).status).toBe(200)
    expect((await read(second.env, user.cookie)).status).toBe(401)
    expect(schemaReads([...first.costs, ...second.costs])).toHaveLength(0)
    expect(sessionReads(second.costs)).not.toHaveLength(0)
  })

  it('retries native schema validation after a transient local database failure', async () => {
    const user = await identity()
    let fail = true
    const DB = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            if (fail && /sqlite_master/i.test(sql)) {
              fail = false
              throw new Error('fixture database unavailable')
            }
            return target.prepare(sql)
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const measured = profileD1({ ...env, DB })
    expect((await read(measured.env, user.cookie)).status).toBe(503)
    expect((await read(measured.env, user.cookie)).status).toBe(200)
    expect(schemaReads(measured.costs).length).toBeGreaterThan(0)
    measured.costs.length = 0
    expect((await read(measured.env, user.cookie)).status).toBe(200)
    expect(schemaReads(measured.costs)).toHaveLength(0)
  })

  it.each([
    ['BETTER_AUTH_SECRET', 'different-test-only-auth-secret-at-least-32-bytes'],
    ['PUBLIC_APP_ORIGIN', 'https://different-origin.example'],
    ['APP_ENV', 'staging'],
    ['AUTH_EMAIL_API_KEY', 'different-test-mail-key'],
    ['AUTH_EMAIL_FROM', 'Changed <changed@example.com>'],
  ] as const)(
    'reinitializes for a changed %s on the same DB and mutable env',
    async (key, value) => {
      const user = await identity(),
        measured = profileD1(env)
      const original = createAuth(measured.env)
      await original.api.getSession({
        headers: new Headers({ Cookie: user.cookie }),
      })
      measured.costs.length = 0
      measured.env[key] = value
      const changed = createAuth(measured.env)
      await changed.api.getSession({
        headers: new Headers({ Cookie: user.cookie }),
      })
      expect(changed === original).toBe(false)
      expect(schemaReads(measured.costs).length).toBeGreaterThan(0)
      measured.costs.length = 0
      expect(createAuth({ ...measured.env }) === changed).toBe(true)
      await changed.api.getSession({
        headers: new Headers({ Cookie: user.cookie }),
      })
      expect(schemaReads(measured.costs)).toHaveLength(0)
      if (key === 'BETTER_AUTH_SECRET')
        expect(
          await changed.api.getSession({
            headers: new Headers({ Cookie: user.cookie }),
          }),
        ).toBeNull()
      if (key === 'PUBLIC_APP_ORIGIN') {
        expect(changed.options.baseURL).toBe(value)
        expect(changed.options.trustedOrigins).toEqual([value])
        expect(
          (
            await changed.handler(
              new Request(`${value}/api/v1/auth/sign-out`, {
                method: 'POST',
                headers: { Origin: origin, Cookie: user.cookie },
              }),
            )
          ).status,
        ).toBe(403)
      }
      if (key === 'APP_ENV')
        expect(changed.options.advanced.useSecureCookies).toBe(true)
      expect(changed.options.session.cookieCache.enabled).toBe(false)
      expect(changed.options.rateLimit).toMatchObject({
        enabled: true,
        storage: 'database',
      })
      measured.env.BETTER_AUTH_SECRET = 'short'
      expect(() => createAuth(measured.env)).toThrow('auth_not_configured')
    },
  )

  it('captures fresh mail configuration without changing in-flight auth closures', async () => {
    const user = await identity(),
      bindings = { ...env }
    const original = createAuth(bindings)
    await original.api.getSession({
      headers: new Headers({ Cookie: user.cookie }),
    })
    const deliveries: Array<{ authorization: string | null; from: string }> = []
    network.use(
      http.post('https://api.resend.com/emails', async ({ request }) => {
        deliveries.push({
          authorization: request.headers.get('Authorization'),
          from: ((await request.json()) as { from: string }).from,
        })
        return HttpResponse.json({ id: 'mock' })
      }),
    )
    bindings.AUTH_EMAIL_API_KEY = 'changed-test-mail-key'
    bindings.AUTH_EMAIL_FROM = 'Changed <changed@example.com>'
    const changed = createAuth(bindings)
    for (const auth of [original, changed])
      await auth.api.changeEmail({
        headers: new Headers({ Cookie: user.cookie }),
        body: { newEmail: `${username()}@example.com` },
      })
    expect(deliveries).toEqual([
      {
        authorization: `Bearer ${env.AUTH_EMAIL_API_KEY}`,
        from: env.AUTH_EMAIL_FROM,
      },
      {
        authorization: 'Bearer changed-test-mail-key',
        from: 'Changed <changed@example.com>',
      },
    ])
  })

  it('reads current sessions, bans, organization membership and venue roles after warmup', async () => {
    const t = await tenant(),
      staff = await member(t, 'venue_manager'),
      measured = profileD1(env)
    const summary = `/staff/venues/${t.venueId}/queues`
    const configure = () =>
      app.request(
        `${origin}/api/v1/staff/venues/${t.venueId}/queues`,
        {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: staff.cookie,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
        measured.env,
      )
    expect((await read(measured.env, staff.cookie, summary)).status).toBe(200)
    expect((await configure()).status).toBe(400)
    await env.DB.prepare(
      "UPDATE venue_membership SET role='viewer' WHERE user_id=? AND venue_id=?",
    )
      .bind(staff.id, t.venueId)
      .run()
    expect((await configure()).status).toBe(403)
    await env.DB.prepare(
      'UPDATE venue_membership SET active=0 WHERE user_id=? AND venue_id=?',
    )
      .bind(staff.id, t.venueId)
      .run()
    expect((await read(measured.env, staff.cookie, summary)).status).toBe(404)
    await env.DB.prepare(
      'UPDATE venue_membership SET active=1 WHERE user_id=? AND venue_id=?',
    )
      .bind(staff.id, t.venueId)
      .run()
    expect((await read(measured.env, staff.cookie, summary)).status).toBe(200)
    await env.DB.prepare(
      'DELETE FROM member WHERE userId=? AND organizationId=?',
    )
      .bind(staff.id, t.organizationId)
      .run()
    expect((await read(measured.env, staff.cookie, summary)).status).toBe(404)
    await env.DB.prepare('UPDATE user SET banned=1 WHERE id=?')
      .bind(staff.id)
      .run()
    expect((await read(measured.env, staff.cookie)).status).toBe(403)
    await env.DB.prepare('UPDATE user SET banned=0 WHERE id=?')
      .bind(staff.id)
      .run()
    expect((await read(measured.env, staff.cookie)).status).toBe(200)
    await env.DB.prepare('DELETE FROM session WHERE userId=?')
      .bind(staff.id)
      .run()
    expect((await read(measured.env, staff.cookie)).status).toBe(401)
    expect(sessionReads(measured.costs).length).toBeGreaterThan(1)
  })
})

describe('explicit queue-scoped staff access', () => {
  async function extraQueue(t: Awaited<ReturnType<typeof tenant>>) {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO queue(id,venue_id,name,capacity,average_minutes,open,version,config) SELECT ?,venue_id,?,capacity,average_minutes,0,0,config FROM queue WHERE id=?',
    )
      .bind(id, 'Unassigned service', t.queueId)
      .run()
    return id
  }
  async function assigned(t: Awaited<ReturnType<typeof tenant>>, id: string) {
    const response = await request(
      `/staff/venues/${t.venueId}/members`,
      t.owner.cookie,
    )
    const data = (await response.json()) as {
      members: { id: string; queueIds: string[] }[]
    }
    return data.members.find((row) => row.id === id)!.queueIds
  }
  it('filters queues and blocks every direct read/operation; newly created queues are not assigned', async () => {
    const t = await tenant(),
      staff = await member(t),
      otherId = await extraQueue(t)
    const list = await request(
      `/staff/venues/${t.venueId}/queues`,
      staff.cookie,
    )
    expect(
      ((await list.json()) as { id: string }[]).map((row) => row.id),
    ).toEqual([t.queueId])
    for (const [suffix, method] of [
      ['entries', 'GET'],
      ['delivery-trace', 'GET'],
      ['opening-context', 'GET'],
      ['entries', 'POST'],
      ['commands', 'POST'],
      ['lifecycle', 'POST'],
    ]) {
      const result = await request(
        `/staff/queues/${otherId}/${suffix}`,
        staff.cookie,
        method,
        method === 'POST' ? {} : undefined,
      )
      expect(result.status, `${method} ${suffix}`).toBe(404)
    }
    expect(
      (await request(`/staff/queues/${otherId}`, staff.cookie, 'PATCH', {}))
        .status,
    ).toBe(404)
    expect(
      (await request(`/staff/queues/${t.queueId}/entries`, staff.cookie))
        .status,
    ).toBe(200)
    expect(await assigned(t, staff.id)).toEqual([t.queueId])
    for (const role of ['viewer', 'venue_manager']) {
      const user = await member(t, role)
      expect(
        (
          (await (
            await request(`/staff/venues/${t.venueId}/queues`, user.cookie)
          ).json()) as unknown[]
        ).length,
      ).toBe(2)
    }
  })
  it('rejects missing, duplicate, unknown and cross-venue grants without creating identities', async () => {
    const t = await tenant(),
      other = await tenant()
    for (const queueIds of [
      undefined,
      [],
      [t.queueId, t.queueId],
      ['missing'],
      [other.queueId],
    ]) {
      const name = username()
      const response = await request(
        `/staff/venues/${t.venueId}/members`,
        t.owner.cookie,
        'POST',
        {
          name: 'New staff',
          username: name,
          password,
          role: 'queue_staff',
          queueIds,
        },
      )
      expect(response.status).toBe(400)
      expect(
        await env.DB.prepare('SELECT id FROM user WHERE username=?')
          .bind(name)
          .first(),
      ).toBeNull()
    }
    const staff = await member(t)
    await expect(
      env.DB.prepare('INSERT INTO staff_queue_assignment VALUES (?,?,?)')
        .bind(staff.id, t.venueId, other.queueId)
        .run(),
    ).rejects.toThrow()
  })
  it('edits grants live, preserves them on active-only changes and clears them on either role endpoint', async () => {
    const t = await tenant(),
      staff = await member(t),
      nextQueue = await extraQueue(t)
    const base = `/staff/venues/${t.venueId}/members/${staff.id}`
    const details = {
      name: 'Staff',
      username: staff.username,
      role: 'queue_staff',
      queueIds: [nextQueue],
    }
    expect(
      (await request(`${base}/details`, t.owner.cookie, 'PATCH', details))
        .status,
    ).toBe(200)
    expect(await assigned(t, staff.id)).toEqual([nextQueue])
    expect(
      (await request(`/staff/queues/${t.queueId}/entries`, staff.cookie))
        .status,
    ).toBe(404)
    expect(
      (await request(`/staff/queues/${nextQueue}/entries`, staff.cookie))
        .status,
    ).toBe(200)
    for (const active of [false, true]) {
      expect(
        (
          await request(base, t.owner.cookie, 'PATCH', {
            role: 'queue_staff',
            active,
          })
        ).status,
      ).toBe(200)
      expect(await assigned(t, staff.id)).toEqual([nextQueue])
    }
    expect(
      (
        await request(`${base}/details`, t.owner.cookie, 'PATCH', {
          ...details,
          role: 'viewer',
          queueIds: [],
        })
      ).status,
    ).toBe(200)
    expect(await assigned(t, staff.id)).toEqual([])
    expect(
      (
        await request(base, t.owner.cookie, 'PATCH', {
          role: 'queue_staff',
          active: true,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(base, t.owner.cookie, 'PATCH', {
          role: 'queue_staff',
          active: true,
          queueIds: [nextQueue],
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request(base, t.owner.cookie, 'PATCH', {
          role: 'viewer',
          active: true,
        })
      ).status,
    ).toBe(200)
    expect(await assigned(t, staff.id)).toEqual([])
  })
  it('rolls back identity, grants, sessions and audit if assignment persistence fails', async () => {
    const t = await tenant(),
      staff = await member(t),
      nextQueue = await extraQueue(t),
      nextName = username()
    await env.DB.prepare(
      "CREATE TRIGGER reject_staff_queue BEFORE INSERT ON staff_queue_assignment BEGIN SELECT RAISE(ABORT,'fixture assignment failure'); END",
    ).run()
    try {
      const response = await request(
        `/staff/venues/${t.venueId}/members/${staff.id}/details`,
        t.owner.cookie,
        'PATCH',
        {
          name: 'Changed',
          username: nextName,
          role: 'queue_staff',
          queueIds: [nextQueue],
        },
      )
      expect(response.status).toBe(503)
      expect(await assigned(t, staff.id)).toEqual([t.queueId])
      expect(
        await env.DB.prepare('SELECT name,username FROM user WHERE id=?')
          .bind(staff.id)
          .first(),
      ).toEqual({ name: 'Staff', username: staff.username })
      expect((await request('/staff/me', staff.cookie)).status).toBe(200)
      expect(
        await env.DB.prepare(
          "SELECT id FROM staff_audit WHERE target_id=? AND action='member.details_updated'",
        )
          .bind(staff.id)
          .first(),
      ).toBeNull()
      const name = username()
      expect(
        (
          await request(
            `/staff/venues/${t.venueId}/members`,
            t.owner.cookie,
            'POST',
            {
              name: 'New staff',
              username: name,
              password,
              role: 'queue_staff',
              queueIds: [t.queueId],
            },
          )
        ).status,
      ).toBe(503)
      expect(
        await env.DB.prepare('SELECT id FROM user WHERE username=?')
          .bind(name)
          .first(),
      ).toBeNull()
    } finally {
      await env.DB.prepare('DROP TRIGGER reject_staff_queue').run()
    }
  })
})
