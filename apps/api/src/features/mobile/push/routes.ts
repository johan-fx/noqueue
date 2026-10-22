import { pushPlatformReady } from './provider'
import { Hono } from 'hono'
import { pushRegistrationSchema } from '@noqueue/contracts/mobile-push'
import { encryptPushToken, hmac, recoveryToken } from '../../queue/crypto'
import { registrationReferenceStatements } from './lifecycle'

export const pushRoutes = new Hono<{ Bindings: CloudflareBindings; Variables: { installationHash: string } }>()
pushRoutes.get('/registration', async c => {
  const row = await c.env.DB.prepare('SELECT enabled FROM mobile_push_registration WHERE installation_hash=?')
    .bind(c.get('installationHash')).first<{ enabled: number }>()
  return c.json({ available: c.env.MOBILE_PUSH_ENABLED === 'true', enabled: row?.enabled === 1, providers: { ios: pushPlatformReady(c.env, 'ios'), android: pushPlatformReady(c.env, 'android') } })
})
pushRoutes.post('/registration', async c => {
  if (c.env.MOBILE_PUSH_ENABLED !== 'true' || !c.env.MOBILE_PUSH_TOKEN_KEY) return c.json({ error: 'push_unavailable' }, 503)
  const parsed = pushRegistrationSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: 'invalid_registration' }, 400)
  const { platform, locale } = parsed.data
  const provider = 'fcm'
  if (!pushPlatformReady(c.env, platform)) return c.json({ error: 'push_unavailable' }, 503)
  const token = parsed.data.token // FCM tokens are opaque and case-sensitive on BOTH platforms.
  const owner = c.get('installationHash'), now = Date.now()
  // A token is not proof of installation ownership: never silently transfer it.
  const tokenHash = await hmac(c.env.MOBILE_PUSH_TOKEN_KEY, `push:${provider}:${token}`)
  const cipher = await encryptPushToken(c.env.MOBILE_PUSH_TOKEN_KEY, token)
  try {
    await c.env.DB.batch([...registrationReferenceStatements(c.env, owner, now), c.env.DB.prepare(`INSERT INTO mobile_push_registration(installation_hash,provider,token_hash,token_cipher,locale,enabled,updated_at,platform)
      VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(installation_hash) DO UPDATE SET provider=excluded.provider,platform=excluded.platform,token_hash=excluded.token_hash,
      token_cipher=excluded.token_cipher,locale=excluded.locale,enabled=1,updated_at=excluded.updated_at`)
      .bind(owner, provider, tokenHash, cipher, locale, now, platform)])
  } catch {
    return c.json({ error: 'registration_conflict' }, 409)
  }
  return c.json({ enabled: true })
})
pushRoutes.post('/revoke', async c => {
  const owner = c.get('installationHash')
  // Delete token material immediately, discard outstanding sends in the same transaction.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM mobile_push_registration WHERE installation_hash=?').bind(owner),
    c.env.DB.prepare("UPDATE mobile_push_outbox SET status='discarded',last_error='revoked' WHERE installation_hash=? AND status IN ('pending','sending')").bind(owner),
  ])
  return c.json({ enabled: false })
})
pushRoutes.get('/notices/:id', async c => {
  const id = c.req.param('id')
  if (!/^[a-f0-9]{32}$/.test(id)) return c.json({ error: 'not_found' }, 404)
  const row = await c.env.DB.prepare(`SELECT e.id,e.locale FROM mobile_push_outbox n
    JOIN mobile_entry_installation m ON m.entry_id=n.entry_id AND m.installation_hash=n.installation_hash
    JOIN queue_entry e ON e.id=n.entry_id JOIN queue q ON q.id=e.queue_id
    JOIN venue v ON v.id=q.venue_id JOIN tenant_account t ON t.organization_id=v.organization_id
    WHERE n.id=? AND n.installation_hash=? AND t.status='active'`)
    .bind(id, c.get('installationHash')).first<{ id: string; locale: 'es' | 'en' }>()
  // Retain resolution for already-ended turns; live entry read determines current UI.
  return row ? c.json({ recoveryToken: await recoveryToken(c.env, row.id), locale: row.locale }) : c.json({ error: 'not_found' }, 404)
})
