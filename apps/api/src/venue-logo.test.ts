import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from './app'
import { createAuth } from './auth/server'
import { issueLocationToken } from './features/staff/location'
import { cleanupVenueLogos } from './features/staff/logo'
import { provision } from './features/staff/provision'
import type { ProvisionInput } from '@noqueue/contracts/staff'

const origin = 'http://localhost:5173'
const password = 'test-only-password-12345'
const logoPath = (venueId: string) => `/staff/venues/${venueId}/logo`

// Tiny, valid 2x1 RGB PNG and JPEG fixtures. Keeping the fixtures inline makes
// the API tests independent of Node filesystem support in the Workers runtime.
const pngBytes = bytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC',
)
const jpegBytes = bytes(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSgBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAEAAgMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/ANHRf+QPYf8AXCP/ANBFfkuI/iz9X+Z+TcXf8j/Hf9fqv/pcj//Z',
)

type LogoState = {
  logo: { url: string; name: string; type: string; size: number } | null
  logoVersion: number
  canEditLogo: boolean
}

function bytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function username() {
  return 'u' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
}

function request(
  path: string,
  cookie = '',
  method = 'GET',
  body?: unknown,
  key?: string,
  requestOrigin = origin,
) {
  return app.request(
    `${origin}/api/v1${path}`,
    {
      method,
      headers: {
        Origin: requestOrigin,
        Cookie: cookie,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  )
}

function uploadRequest(
  venueId: string,
  cookie: string,
  file: File,
  version: number,
  key = crypto.randomUUID(),
) {
  const body = new FormData()
  body.set('file', file)
  body.set('version', String(version))
  return app.request(
    `${origin}/api/v1${logoPath(venueId)}`,
    {
      method: 'PUT',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Idempotency-Key': key,
      },
      body,
    },
    env,
  )
}

function uploadFile(
  content: Uint8Array,
  name: string,
  type: string,
) {
  return new File([content], name, { type })
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
  await env.DB.prepare('DELETE FROM rateLimit').run()
  const response = await request('/auth/sign-in/username', '', 'POST', {
    username: name,
    password,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  return { id: user.id, username: name, cookie }
}

function provisionInput(name = username()): ProvisionInput {
  const locationOperationId = crypto.randomUUID()
  return {
    locationToken: '',
    locationOperationId,
    organizationName: 'Logo Test Hotel',
    slug: `logo-test-${crypto.randomUUID()}`,
    venueName: 'Logo Test Madrid',
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
  const sales = await identity('commercial_operator')
  const draft = provisionInput()
  const location = await issueLocationToken(
    env,
    sales.id,
    { kind: 'provision', id: draft.locationOperationId },
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
      providerId: 'logo-test-fixture',
      attribution: [
        { text: 'Geoapify', url: 'https://www.geoapify.com/' },
      ],
    },
  )
  const provisioned = await provision(env, sales.id, crypto.randomUUID(), {
    ...draft,
    locationToken: location.token,
  })
  const owner = {
    id: provisioned.userId,
    ...(await loginExistingOwner(draft.ownerUsername)),
  }
  return { sales, owner, ...provisioned }
}

async function loginExistingOwner(name: string) {
  await env.DB.prepare('DELETE FROM rateLimit').run()
  const response = await request('/auth/sign-in/username', '', 'POST', {
    username: name,
    password,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return {
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  }
}

async function member(
  venueId: string,
  ownerCookie: string,
  role: 'venue_manager' | 'queue_staff' | 'viewer',
) {
  const name = username()
  const response = await request(
    `/staff/venues/${venueId}/members`,
    ownerCookie,
    'POST',
    { name: 'Logo Test Member', username: name, password, role },
  )
  expect(response.status, await response.clone().text()).toBe(201)
  const result = (await response.json()) as { id: string }
  return { ...result, ...(await loginExistingOwner(name)) }
}

async function currentState(venueId: string, cookie: string) {
  const response = await request(logoPath(venueId), cookie)
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()) as LogoState
}

async function stateOrError(response: Response) {
  return (await response.json()) as LogoState | { error: string }
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rateLimit').run()
  await env.DB.prepare('DELETE FROM staff_rate').run()
})

describe('venue logo API', () => {
  it('returns an empty state and accepts PNG/JPEG with versioned URLs', async () => {
    const t = await tenant()
    const initial = await currentState(t.venueId, t.owner.cookie)
    expect(initial).toEqual({ logo: null, logoVersion: 0, canEditLogo: true })

    const png = await uploadRequest(
      t.venueId,
      t.owner.cookie,
      uploadFile(pngBytes, 'hotel.png', 'image/png'),
      initial.logoVersion,
    )
    expect(png.status, await png.clone().text()).toBe(200)
    const pngState = (await png.json()) as LogoState
    expect(pngState).toMatchObject({
      logo: {
        name: 'hotel.png',
        type: 'image/png',
        size: expect.any(Number),
      },
      logoVersion: 1,
      canEditLogo: true,
    })
    expect(pngState.logo?.url).toContain('/api/v1/venue-logos/')
    expect(pngState.logo?.url).toMatch(/\/[0-9a-f-]+\.png(?:\?|$)/i)
    const publicImage = await app.request(`${origin}${pngState.logo!.url}`, {}, env)
    expect(publicImage.status).toBe(200)
    expect(publicImage.headers.get('Content-Type')).toContain('image/png')
    expect(publicImage.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(publicImage.headers.get('Cache-Control')).toContain('immutable')

    const jpeg = await uploadRequest(
      t.venueId,
      t.owner.cookie,
      uploadFile(jpegBytes, 'hotel.jpg', 'image/jpeg'),
      pngState.logoVersion,
    )
    expect(jpeg.status, await jpeg.clone().text()).toBe(200)
    expect(await jpeg.json()).toMatchObject({
      logo: {
        name: 'hotel.jpg',
        type: 'image/jpeg',
        size: expect.any(Number),
      },
      logoVersion: 2,
    })
  })

  it('authorizes only scoped sales, platform admins and active owners to mutate', async () => {
    const t = await tenant(),
      manager = await member(t.venueId, t.owner.cookie, 'venue_manager'),
      staff = await member(t.venueId, t.owner.cookie, 'queue_staff'),
      viewer = await member(t.venueId, t.owner.cookie, 'viewer'),
      admin = await identity('platform_admin'),
      unrelatedSales = await identity('commercial_operator'),
      outsider = await identity()

    for (const actor of [t.owner, t.sales, admin, manager, staff, viewer]) {
      const state = await currentState(t.venueId, actor.cookie)
      expect(state.canEditLogo).toBe(
        actor === t.owner || actor === t.sales || actor === admin,
      )
    }
    for (const actor of [t.owner, t.sales, admin]) {
      const state = await currentState(t.venueId, actor.cookie)
      const response = await uploadRequest(
        t.venueId,
        actor.cookie,
        uploadFile(pngBytes, 'scope.png', 'image/png'),
        state.logoVersion,
      )
      expect(response.status, await response.clone().text()).toBe(200)
    }
    for (const actor of [manager, staff, viewer]) {
      const state = await currentState(t.venueId, actor.cookie)
      const denied = await uploadRequest(
        t.venueId,
        actor.cookie,
        uploadFile(pngBytes, 'denied.png', 'image/png'),
        state.logoVersion,
      )
      expect(denied.status, await denied.clone().text()).toBe(403)
    }
    for (const actor of [unrelatedSales, outsider]) {
      const denied = await request(logoPath(t.venueId), actor.cookie)
      expect(denied.status).toBe(404)
    }
    const noSession = await request(logoPath(t.venueId), '')
    expect(noSession.status).toBe(401)
  })

  it('denies inactive/suspended owners but preserves existing sales/platform scope', async () => {
    const t = await tenant(),
      admin = await identity('platform_admin')
    await env.DB.prepare(
      "UPDATE venue_membership SET active=0 WHERE user_id=? AND venue_id=?",
    )
      .bind(t.owner.id, t.venueId)
      .run()
    expect((await request(logoPath(t.venueId), t.owner.cookie)).status).toBe(404)
    expect(
      (
        await uploadRequest(
          t.venueId,
          t.owner.cookie,
          uploadFile(pngBytes, 'inactive.png', 'image/png'),
          0,
        )
      ).status,
    ).toBe(404)

    await env.DB.prepare(
      "UPDATE venue_membership SET active=1 WHERE user_id=? AND venue_id=?",
    )
      .bind(t.owner.id, t.venueId)
      .run()
    await env.DB.prepare(
      "UPDATE tenant_account SET status='suspended' WHERE organization_id=?",
    )
      .bind(t.organizationId)
      .run()

    expect((await request(logoPath(t.venueId), t.owner.cookie)).status).toBe(404)
    expect(
      (
        await uploadRequest(
          t.venueId,
          t.owner.cookie,
          uploadFile(pngBytes, 'suspended.png', 'image/png'),
          0,
        )
      ).status,
    ).toBe(404)
    expect((await currentState(t.venueId, t.sales.cookie)).canEditLogo).toBe(true)
    expect((await currentState(t.venueId, admin.cookie)).canEditLogo).toBe(true)
    const salesUpload = await uploadRequest(
      t.venueId,
      t.sales.cookie,
      uploadFile(pngBytes, 'sales.png', 'image/png'),
      0,
    )
    expect(salesUpload.status, await salesUpload.clone().text()).toBe(200)
    const adminUpload = await uploadRequest(
      t.venueId,
      admin.cookie,
      uploadFile(jpegBytes, 'admin.jpg', 'image/jpeg'),
      1,
    )
    expect(adminUpload.status, await adminUpload.clone().text()).toBe(200)
  })

  it('rejects fake/truncated images and unsafe or unrenderable SVG content', async () => {
    const t = await tenant()
    const cases = [
      uploadFile(bytes('aGVsbG8gd29ybGQ='), 'fake.png', 'image/png'),
      uploadFile(pngBytes, 'wrong-mime.png', 'image/jpeg'),
      uploadFile(pngBytes.slice(0, 14), 'truncated.png', 'image/png'),
      uploadFile(
        bytes(
          btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        ),
        'script.svg',
        'image/svg+xml',
      ),
      uploadFile(
        bytes(
          btoa(
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/x.png"/></svg>',
          ),
        ),
        'remote.svg',
        'image/svg+xml',
      ),
      uploadFile(
        bytes(btoa('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>')),
        'broken.svg',
        'image/svg+xml',
      ),
      uploadFile(
        bytes(
          btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="1" height="1"/></svg>',
          ),
        ),
        'bounds.svg',
        'image/svg+xml',
      ),
    ]
    let version = 0
    for (const file of cases) {
      const response = await uploadRequest(t.venueId, t.owner.cookie, file, version)
      expect(response.status, await response.clone().text()).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_logo' })
    }
  })

  it('rasterizes a safe SVG to PNG and rejects oversized uploads with a file-specific error', async () => {
    const t = await tenant()
    const svg = uploadFile(
      bytes(
        btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16" viewBox="0 0 32 16"><rect width="32" height="16" fill="#0f766e"/></svg>',
        ),
      ),
      'hotel.svg',
      'image/svg+xml',
    )
    const rasterized = await uploadRequest(t.venueId, t.owner.cookie, svg, 0)
    expect(rasterized.status, await rasterized.clone().text()).toBe(200)
    const state = (await rasterized.json()) as LogoState
    expect(state.logo).toMatchObject({ name: 'hotel.png', type: 'image/png' })
    expect(state.logo?.size).toBeGreaterThan(0)
    expect(state.logo?.url).toMatch(/\.png(?:\?|$)/)

    const tooLarge = uploadFile(
      new Uint8Array(5 * 1024 * 1024 + 1),
      'large.png',
      'image/png',
    )
    const rejected = await uploadRequest(
      t.venueId,
      t.owner.cookie,
      tooLarge,
      state.logoVersion,
    )
    expect(rejected.status, await rejected.clone().text()).toBe(413)
    expect(await rejected.json()).toEqual({ error: 'logo_too_large' })
  })

  it('requires origin and stable idempotency keys, enforces optimistic versions and replays mutations', async () => {
    const t = await tenant()
    const noOrigin = await app.request(
      `${origin}/api/v1${logoPath(t.venueId)}`,
      {
        method: 'PUT',
        headers: { Origin: 'https://attacker.invalid', Cookie: t.owner.cookie },
        body: new FormData(),
      },
      env,
    )
    expect(noOrigin.status).toBe(403)

    const noKeyForm = new FormData()
    noKeyForm.set('version', '0')
    noKeyForm.set('file', uploadFile(pngBytes, 'first.png', 'image/png'))
    const noKey = await app.request(
      `${origin}/api/v1${logoPath(t.venueId)}`,
      {
        method: 'PUT',
        headers: { Origin: origin, Cookie: t.owner.cookie },
        body: noKeyForm,
      },
      env,
    )
    expect(noKey.status).toBe(400)
    expect(await noKey.json()).toEqual({ error: 'invalid_idempotency_key' })

    const key = crypto.randomUUID()
    const first = await uploadRequest(
      t.venueId,
      t.owner.cookie,
      uploadFile(pngBytes, 'first.png', 'image/png'),
      0,
      key,
    )
    expect(first.status, await first.clone().text()).toBe(200)
    const firstState = (await first.json()) as LogoState
    const replay = await uploadRequest(
      t.venueId,
      t.owner.cookie,
      uploadFile(pngBytes, 'first.png', 'image/png'),
      0,
      key,
    )
    expect(replay.status, await replay.clone().text()).toBe(200)
    expect(await replay.json()).toEqual(firstState)

    const changedPayload = await uploadRequest(
      t.venueId,
      t.owner.cookie,
      uploadFile(jpegBytes, 'other.jpg', 'image/jpeg'),
      0,
      key,
    )
    expect(changedPayload.status).toBe(409)
    expect(await changedPayload.json()).toEqual({ error: 'idempotency_conflict' })

    const replacementKey = crypto.randomUUID()
    const replacement = await uploadRequest(
      t.venueId,
      t.owner.cookie,
      uploadFile(jpegBytes, 'second.jpg', 'image/jpeg'),
      firstState.logoVersion,
      replacementKey,
    )
    expect(replacement.status, await replacement.clone().text()).toBe(200)
    const replacementState = (await replacement.json()) as LogoState
    const staleDelete = await request(
      logoPath(t.venueId),
      t.owner.cookie,
      'DELETE',
      { version: firstState.logoVersion },
      crypto.randomUUID(),
    )
    expect(staleDelete.status).toBe(409)
    expect(await staleDelete.json()).toEqual({ error: 'logo_version_conflict' })

    const deleteKey = crypto.randomUUID()
    const deletion = await request(
      logoPath(t.venueId),
      t.owner.cookie,
      'DELETE',
      { version: replacementState.logoVersion },
      deleteKey,
    )
    expect(deletion.status, await deletion.clone().text()).toBe(200)
    const deletedState = (await deletion.json()) as LogoState
    expect(deletedState).toMatchObject({ logo: null, logoVersion: 3 })
    const deleteReplay = await request(
      logoPath(t.venueId),
      t.owner.cookie,
      'DELETE',
      { version: replacementState.logoVersion },
      deleteKey,
    )
    expect(deleteReplay.status, await deleteReplay.clone().text()).toBe(200)
    expect(await deleteReplay.json()).toEqual(deletedState)

    const cleanupTime = Date.now() + 2 * 60 * 60 * 1000
    await cleanupVenueLogos(env, cleanupTime)
    for (const oldLogoUrl of [firstState.logo!.url, replacementState.logo!.url]) {
      const oldObject = await app.request(`${origin}${oldLogoUrl}`, {}, env)
      expect(oldObject.status).toBe(404)
    }
  })

  it('keeps ordinary staff endpoints under the existing 64 KiB body limit', async () => {
    const t = await tenant()
    const response = await request(
      `/staff/venues/${t.venueId}/queues`,
      t.owner.cookie,
      'POST',
      { filler: 'x'.repeat(66 * 1024) },
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'request_too_large' })
  })
})

it('projects only the current logo URL publicly, scoped to the venue and active tenant', async () => {
  const t = await tenant()
  const other = await tenant()
  const queueFor = async (venueId: string) => (await env.DB.prepare('SELECT id FROM queue WHERE venue_id=?').bind(venueId).first<{ id: string }>())!.id
  const queue = await queueFor(t.venueId)
  const otherQueue = await queueFor(other.venueId)
  const read = () => request(`/public/services/${queue}`)
  expect(await (await read()).json()).toMatchObject({ venueLogoUrl: null })
  for (const version of [0, 1]) {
    const uploaded = await uploadRequest(t.venueId, t.owner.cookie, uploadFile(pngBytes, 'private-filename.png', 'image/png'), version)
    expect(uploaded.status).toBe(200)
    const state = await uploaded.json() as LogoState
    const response = await read()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json() as Record<string, unknown>
    expect(body.venueLogoUrl).toBe(state.logo!.url)
    for (const field of ['logo', 'logo_key', 'logo_name', 'logo_size', 'logoVersion', 'canEditLogo']) expect(body).not.toHaveProperty(field)
    expect(JSON.stringify(body)).not.toContain('private-filename')
    expect(await (await request(`/public/services/${otherQueue}`)).json()).toMatchObject({ venueLogoUrl: null })
  }
  const removed = await request(logoPath(t.venueId), t.owner.cookie, 'DELETE', { version: 2 }, crypto.randomUUID())
  expect(removed.status).toBe(200)
  expect(await (await read()).json()).toMatchObject({ venueLogoUrl: null })
  await env.DB.prepare("UPDATE tenant_account SET status='suspended' WHERE organization_id=(SELECT organization_id FROM venue WHERE id=?)").bind(t.venueId).run()
  expect((await read()).status).toBe(404)
})
