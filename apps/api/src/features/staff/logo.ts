import { HTTPException } from 'hono/http-exception'
import type { VenueLogoState } from '@noqueue/contracts/staff'
import { isCommercial } from '../../auth/permissions'
import { normalizeLogo } from './logo-image'
import { venueLogoUrl, venueLogosEnabled } from '../../lib/venue-logo'

export type LogoActor = { id: string; role: string }
type LogoRow = {
  id: string
  organizationId: string
  logo_key: string | null
  logo_name: string | null
  logo_type: 'image/png' | 'image/jpeg' | null
  logo_size: number | null
  logo_version: number
}
const day = 86400000

/** Branding grants are independent of queue.configure and of organization.logo. */
export async function venueLogoAccess(
  env: CloudflareBindings,
  actor: LogoActor,
  venueId: string,
  write = false,
) {
  const row = await env.DB.prepare(
    `SELECT v.organization_id AS organizationId,t.created_by,t.status,
      vm.role,vm.active, m.id AS memberId
     FROM venue v JOIN tenant_account t ON t.organization_id=v.organization_id
     LEFT JOIN venue_membership vm ON vm.venue_id=v.id AND vm.user_id=?
     LEFT JOIN member m ON m.organizationId=v.organization_id AND m.userId=?
     WHERE v.id=?`,
  )
    .bind(actor.id, actor.id, venueId)
    .first<{
      organizationId: string
      created_by: string
      status: string
      role: string | null
      active: number | null
      memberId: string | null
    }>()
  if (!row) throw new HTTPException(404, { message: 'not_found' })
  const commercial =
    isCommercial(actor.role) &&
    (actor.role === 'platform_admin' || row.created_by === actor.id)
  const membership =
    row.active === 1 && !!row.memberId && row.status === 'active'
  if (!commercial && !membership)
    throw new HTTPException(404, { message: 'not_found' })
  const canEditLogo = commercial || (membership && row.role === 'owner')
  if (write && !canEditLogo)
    throw new HTTPException(403, { message: 'forbidden' })
  return { organizationId: row.organizationId, canEditLogo }
}

export function venueLogoFields(
  env: CloudflareBindings,
  row: Pick<
    LogoRow,
    'logo_key' | 'logo_name' | 'logo_type' | 'logo_size' | 'logo_version'
  >,
  canEditLogo: boolean,
): VenueLogoState {
  return {
    logo: venueLogosEnabled(env) && row.logo_key
      ? {
          url: venueLogoUrl(env, row.logo_key)!,
          name: row.logo_name!,
          type: row.logo_type!,
          size: row.logo_size!,
        }
      : null,
    logoVersion: row.logo_version,
    canEditLogo: canEditLogo && venueLogosEnabled(env),
  }
}
async function readRow(env: CloudflareBindings, venueId: string) {
  const row = await env.DB.prepare(
    'SELECT id,organization_id AS organizationId,logo_key,logo_name,logo_type,logo_size,logo_version FROM venue WHERE id=?',
  )
    .bind(venueId)
    .first<LogoRow>()
  if (!row) throw new HTTPException(404, { message: 'not_found' })
  return row
}
export async function readVenueLogo(
  env: CloudflareBindings,
  actor: LogoActor,
  venueId: string,
) {
  const access = await venueLogoAccess(env, actor, venueId)
  return venueLogoFields(env, await readRow(env, venueId), access.canEditLogo)
}
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
}
async function replay(
  env: CloudflareBindings,
  actor: LogoActor,
  venueId: string,
  key: string,
  fingerprint: string,
) {
  const previous = await env.DB.prepare(
    'SELECT request_hash FROM venue_logo_request WHERE actor_id=? AND venue_id=? AND request_key=?',
  )
    .bind(actor.id, venueId, key)
    .first<{ request_hash: string }>()
  if (!previous) return null
  if (previous.request_hash !== fingerprint)
    throw new HTTPException(409, { message: 'idempotency_conflict' })
  return readVenueLogo(env, actor, venueId)
}

export async function mutateVenueLogo(
  env: CloudflareBindings,
  actor: LogoActor,
  venueId: string,
  version: number,
  requestKey: string,
  file: File | null,
): Promise<VenueLogoState> {
  const access = await venueLogoAccess(env, actor, venueId, true)
  if (!venueLogosEnabled(env))
    throw new HTTPException(503, { message: 'venue_logos_disabled' })
  const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null
  const fingerprint = await digest(
    new TextEncoder().encode(
      JSON.stringify({
        version,
        operation: file ? 'put' : 'delete',
        name: file?.name,
        type: file?.type,
        digest: bytes ? await digest(bytes) : null,
      }),
    ),
  )
  const previous = await replay(env, actor, venueId, requestKey, fingerprint)
  if (previous) return previous
  const current = await readRow(env, venueId)
  if (current.logo_version !== version)
    throw new HTTPException(409, { message: 'logo_version_conflict' })
  const normalized = file && bytes ? await normalizeLogo(file, bytes) : null
  const objectId = crypto.randomUUID()
  const objectKey = normalized
    ? `${venueId}/${objectId}.${
        normalized.type === 'image/png' ? 'png' : 'jpg'
      }`
    : null
  const now = Date.now()
  if (normalized && objectKey) {
    // Durable intent precedes R2. A crash at any later await cannot leak an untracked object.
    await env.DB.prepare(
      'INSERT INTO venue_logo_object(id,venue_id,key,created_at,delete_after) VALUES (?,?,?,?,?)',
    )
      .bind(objectId, venueId, objectKey, now, now + day)
      .run()
    try {
      await env.VENUE_LOGOS.put(objectKey, normalized.bytes, {
        httpMetadata: {
          contentType: normalized.type,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      })
    } finally {
      // The collector retains unfinished intents: a slow PUT must not recreate
      // an untracked object after a cleanup delete. A crash leaves a tombstone.
      await env.DB.prepare(
        'UPDATE venue_logo_object SET upload_finished=1 WHERE id=?',
      )
        .bind(objectId)
        .run()
    }
  }
  // Recheck a membership revoked while validating/uploading.
  await venueLogoAccess(env, actor, venueId, true)
  const auditId = crypto.randomUUID()
  try {
    const result = await env.DB.batch([
      env.DB.prepare(
        `UPDATE venue SET logo_key=?,logo_name=?,logo_type=?,logo_size=?,logo_version=logo_version+1,configuration_updated_at=?
         WHERE id=? AND logo_version=? AND (? IS NULL OR EXISTS (
           SELECT 1 FROM venue_logo_object WHERE id=? AND delete_after>?
         ))`,
      ).bind(
        objectKey,
        normalized?.name ?? null,
        normalized?.type ?? null,
        normalized?.bytes.byteLength ?? null,
        now,
        venueId,
        version,
        objectKey,
        objectId,
        Date.now(),
      ),
      env.DB.prepare(
        'INSERT INTO staff_audit SELECT ?,?,?,?,?,?,? WHERE changes()=1',
      ).bind(
        auditId,
        actor.id,
        access.organizationId,
        venueId,
        file ? 'venue.logo_updated' : 'venue.logo_deleted',
        venueId,
        now,
      ),
      env.DB.prepare(
        'INSERT INTO venue_logo_request SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM staff_audit WHERE id=?)',
      ).bind(actor.id, venueId, requestKey, fingerprint, now, auditId),
      env.DB.prepare(
        `UPDATE venue_logo_object SET delete_after=MIN(delete_after,?)
         WHERE key=? AND EXISTS(SELECT 1 FROM staff_audit WHERE id=?)`,
      ).bind(now + 3600000, current.logo_key, auditId),
    ])
    if (!result[0]?.meta.changes) {
      const raced = await replay(env, actor, venueId, requestKey, fingerprint)
      if (raced) return raced
      throw new HTTPException(409, { message: 'logo_version_conflict' })
    }
  } catch (error) {
    // A lost D1 response or a concurrent identical request may have committed.
    const committed = await replay(env, actor, venueId, requestKey, fingerprint)
    if (committed) return committed
    // Do not delete here: a failed response does not establish whether D1 committed.
    // The durable collector always checks references before touching R2.
    throw error
  }
  return readVenueLogo(env, actor, venueId)
}

/** Claim in D1 before deleting. Commits cannot adopt a claimed/expired object. */
export async function cleanupVenueLogos(
  env: CloudflareBindings,
  now = Date.now(),
) {
  // Do not claim or delete records while storage is unavailable/disabled.
  if (!venueLogosEnabled(env)) return
  const claimed = await env.DB.prepare(
    `UPDATE venue_logo_object SET delete_after=0,cleanup_attempted_at=? WHERE id IN (
      SELECT o.id FROM venue_logo_object o WHERE o.delete_after<=?
       AND NOT EXISTS(SELECT 1 FROM venue v WHERE v.logo_key=o.key)
      ORDER BY o.cleanup_attempted_at,o.delete_after,o.id LIMIT 25
    ) RETURNING id,key,upload_finished`,
  )
    .bind(now, now)
    .all<{ id: string; key: string; upload_finished: number }>()
  for (const object of claimed.results) {
    try {
      await env.VENUE_LOGOS.delete(object.key)
      // Use the claim snapshot, not a fresh flag: PUT may have finished after
      // the deletion and must be followed by another delete on the next sweep.
      if (object.upload_finished) {
        await env.DB.prepare(
          'DELETE FROM venue_logo_object WHERE id=? AND delete_after=0',
        )
          .bind(object.id)
          .run()
      }
    } catch {
      console.error('venue_logo_cleanup_failed')
      // Keep the durable claim; later sweeps retry without permitting adoption.
    }
  }
}

/** Local only; production files use the dedicated R2 custom domain. */
export async function localVenueLogo(
  env: CloudflareBindings,
  venue: string,
  object: string,
  method: string,
) {
  if (
    env.APP_ENV !== 'local' || !venueLogosEnabled(env) ||
    !/^[\da-f-]{36}$/.test(venue) ||
    !/^[\da-f-]{36}\.(png|jpg)$/.test(object)
  )
    return new Response(null, { status: 404 })
  const stored = await env.VENUE_LOGOS.get(`${venue}/${object}`)
  if (!stored)
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  const headers = new Headers()
  stored.writeHttpMetadata(headers)
  headers.set('ETag', stored.httpEtag)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
  return new Response(method === 'HEAD' ? null : stored.body, { headers })
}
