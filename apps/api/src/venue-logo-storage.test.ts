import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { encode } from 'fast-png'
import {
  cleanupVenueLogos,
  mutateVenueLogo,
  readVenueLogo,
} from './features/staff/logo'

const day = 86400000
const png = () =>
  new File(
    [
      encode({
        width: 1,
        height: 1,
        channels: 4,
        data: new Uint8Array([255, 0, 0, 255]),
      }),
    ],
    'logo.png',
    { type: 'image/png' },
  )
async function setup() {
  const actor = { id: crypto.randomUUID(), role: 'commercial_operator' }
  const org = crypto.randomUUID(),
    venue = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO user(id,name,email,createdAt,updatedAt,role) VALUES (?,?,?,?,?,?)',
    ).bind(
      actor.id,
      'Logo Test',
      `${actor.id}@example.invalid`,
      '2026-10-13',
      '2026-10-13',
      actor.role,
    ),
    env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(
      org,
      'Logo Test',
    ),
    env.DB.prepare(
      'INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)',
    ).bind(org, actor.id),
    env.DB.prepare(
      'INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)',
    ).bind(venue, org, 'Logo Test'),
  ])
  return { actor, org, venue }
}
function override<T extends object>(target: T, members: Partial<T>): T {
  return new Proxy(target, {
    get(object, name) {
      if (Object.prototype.hasOwnProperty.call(members, name))
        return Reflect.get(members, name)
      const value = Reflect.get(object, name)
      return typeof value === 'function' ? value.bind(object) : value
    },
  })
}

describe('logo cross-storage failure consistency', () => {
  it('tracks a failed R2 put and never replaces the old logo', async () => {
    const { actor, venue } = await setup()
    const old = await mutateVenueLogo(
      env,
      actor,
      venue,
      0,
      crypto.randomUUID(),
      png(),
    )
    const broken = {
      ...env,
      VENUE_LOGOS: override(env.VENUE_LOGOS, {
        put: async () => {
          throw Error('R2 down')
        },
      }),
    }
    await expect(
      mutateVenueLogo(broken, actor, venue, 1, crypto.randomUUID(), png()),
    ).rejects.toThrow('R2 down')
    expect(await readVenueLogo(env, actor, venue)).toEqual(old)
    expect(
      (
        await env.DB.prepare(
          'SELECT COUNT(*) n FROM venue_logo_object WHERE venue_id=?',
        )
          .bind(venue)
          .first<{ n: number }>()
      )?.n,
    ).toBe(2)
    await cleanupVenueLogos(env, Date.now() + 2 * day)
    expect(
      (
        await env.DB.prepare(
          'SELECT COUNT(*) n FROM venue_logo_object WHERE venue_id=?',
        )
          .bind(venue)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1)
    expect((await readVenueLogo(env, actor, venue)).logo).toEqual(old.logo)
  })

  it('collects a successful R2 put when D1 fails before commit', async () => {
    const { actor, venue } = await setup()
    const broken = {
      ...env,
      DB: override(env.DB, {
        batch: async () => {
          throw Error('D1 down')
        },
      }),
    }
    await expect(
      mutateVenueLogo(broken, actor, venue, 0, crypto.randomUUID(), png()),
    ).rejects.toThrow('D1 down')
    const object = await env.DB.prepare(
      'SELECT key FROM venue_logo_object WHERE venue_id=?',
    )
      .bind(venue)
      .first<{ key: string }>()
    expect(await env.VENUE_LOGOS.head(object!.key)).not.toBeNull()
    expect((await readVenueLogo(env, actor, venue)).logo).toBeNull()
    await cleanupVenueLogos(env, Date.now() + 2 * day)
    expect(await env.VENUE_LOGOS.head(object!.key)).toBeNull()
  })

  it('recovers a lost commit response, and replay cannot restore an older logo', async () => {
    const { actor, venue } = await setup(),
      key = crypto.randomUUID(),
      file = png()
    const lossy = {
      ...env,
      DB: override(env.DB, {
        batch: async (statements) => {
          await env.DB.batch(statements)
          throw Error('response lost after COMMIT')
        },
      }),
    }
    const first = await mutateVenueLogo(lossy, actor, venue, 0, key, file)
    expect(first.logoVersion).toBe(1)
    const next = await mutateVenueLogo(
      env,
      actor,
      venue,
      1,
      crypto.randomUUID(),
      png(),
    )
    const replay = await mutateVenueLogo(env, actor, venue, 0, key, file)
    expect(replay).toEqual(next)
    expect(replay.logo?.url).not.toBe(first.logo?.url)
  })

  it('keeps exactly one winning reference after two concurrent replacements', async () => {
    const { actor, venue } = await setup()
    const results = await Promise.allSettled([
      mutateVenueLogo(env, actor, venue, 0, crypto.randomUUID(), png()),
      mutateVenueLogo(env, actor, venue, 0, crypto.randomUUID(), png()),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    await cleanupVenueLogos(env, Date.now() + 2 * day)
    expect(
      (
        await env.DB.prepare(
          'SELECT COUNT(*) n FROM venue_logo_object WHERE venue_id=?',
        )
          .bind(venue)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1)
    const current = await env.DB.prepare(
      'SELECT logo_key FROM venue WHERE id=?',
    )
      .bind(venue)
      .first<{ logo_key: string }>()
    expect(await env.VENUE_LOGOS.head(current!.logo_key)).not.toBeNull()
  })

  it('cannot commit an object claimed by cleanup while PUT was in progress', async () => {
    const { actor, venue } = await setup()
    const delayed = {
      ...env,
      VENUE_LOGOS: override(env.VENUE_LOGOS, {
        put: async (...args: Parameters<R2Bucket['put']>) => {
          const object = await env.VENUE_LOGOS.put(...args)
          await cleanupVenueLogos(env, Date.now() + 2 * day)
          return object
        },
      }),
    }
    await expect(
      mutateVenueLogo(delayed, actor, venue, 0, crypto.randomUUID(), png()),
    ).rejects.toMatchObject({ status: 409 })
    expect((await readVenueLogo(env, actor, venue)).logo).toBeNull()
  })

  it('retains the intent when a slow PUT finishes after the collector deleted its key', async () => {
    const { actor, venue } = await setup()
    const delayed = {
      ...env,
      VENUE_LOGOS: override(env.VENUE_LOGOS, {
        put: async (...args: Parameters<R2Bucket['put']>) => {
          await cleanupVenueLogos(env, Date.now() + 2 * day)
          return env.VENUE_LOGOS.put(...args)
        },
      }),
    }
    await expect(
      mutateVenueLogo(delayed, actor, venue, 0, crypto.randomUUID(), png()),
    ).rejects.toMatchObject({ status: 409 })
    const object = await env.DB.prepare(
      'SELECT key FROM venue_logo_object WHERE venue_id=?',
    )
      .bind(venue)
      .first<{ key: string }>()
    expect(object).not.toBeNull()
    expect(await env.VENUE_LOGOS.head(object!.key)).not.toBeNull()
    await cleanupVenueLogos(env, Date.now() + 2 * day)
    expect(await env.VENUE_LOGOS.head(object!.key)).toBeNull()
  })

  it('retains a cleanup claim after delete failure and retries safely', async () => {
    const { actor, venue } = await setup()
    await mutateVenueLogo(env, actor, venue, 0, crypto.randomUUID(), png())
    await mutateVenueLogo(env, actor, venue, 1, crypto.randomUUID(), null)
    const object = await env.DB.prepare(
      'SELECT key FROM venue_logo_object WHERE venue_id=?',
    )
      .bind(venue)
      .first<{ key: string }>()
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await cleanupVenueLogos(
        {
          ...env,
          VENUE_LOGOS: override(env.VENUE_LOGOS, {
            delete: async () => {
              throw Error('delete unavailable')
            },
          }),
        },
        Date.now() + 2 * day,
      )
      expect(await env.VENUE_LOGOS.head(object!.key)).not.toBeNull()
      await cleanupVenueLogos(env, Date.now() + 2 * day)
      expect(await env.VENUE_LOGOS.head(object!.key)).toBeNull()
    } finally {
      silence.mockRestore()
    }
  })

  it('rotates unfinished tombstones so they cannot starve later cleanup work', async () => {
    const { venue } = await setup()
    const now = Date.now()
    const records = Array.from({ length: 26 }, (_, index) => ({
      id: crypto.randomUUID(),
      key: `${venue}/cleanup-${index}.png`,
      finished: index === 25 ? 1 : 0,
    }))
    await env.DB.batch(
      records.map((record, index) =>
        env.DB.prepare(
          'INSERT INTO venue_logo_object(id,venue_id,key,created_at,delete_after,upload_finished) VALUES (?,?,?,?,?,?)',
        ).bind(
          record.id,
          venue,
          record.key,
          now,
          now - 100 + index,
          record.finished,
        ),
      ),
    )
    const last = records[25]!
    await env.VENUE_LOGOS.put(last.key, 'orphan')
    await cleanupVenueLogos(env, now)
    expect(await env.VENUE_LOGOS.head(last.key)).not.toBeNull()
    await cleanupVenueLogos(env, now + 1)
    expect(await env.VENUE_LOGOS.head(last.key)).toBeNull()
    expect(
      await env.DB.prepare('SELECT id FROM venue_logo_object WHERE id=?')
        .bind(last.id)
        .first(),
    ).toBeNull()
  })
})
