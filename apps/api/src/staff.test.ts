import { env } from 'cloudflare:workers'
import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
} from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { app } from './app'
import { createAuth } from './auth/server'
import { provisionSchema, type ProvisionInput } from '@noqueue/contracts/staff'
import { provision } from './features/staff/provision'
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
async function tenant() {
  const sales = await identity('commercial_operator'),
    data = input()
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
    { name: 'Staff', username: name, password, role },
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
      data = input(),
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
    const data = input()
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
    expect(
      (
        await request(`/staff/queues/${result.id}`, t.owner.cookie, 'PATCH', {
          ...service,
          version: 0,
          open: true,
        })
      ).status,
    ).toBe(200)
    const joinPath = `/public/services/${result.id}/entries`
    const joined = await request(
      joinPath,
      '',
      'POST',
      { partySize: 2, locale: 'es' },
      crypto.randomUUID(),
    )
    expect(joined.status).toBe(201)
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
