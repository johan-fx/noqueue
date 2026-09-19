import type { ProvisionInput } from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { audit } from '../../auth/access'
import {
  credentialStatements,
  membershipStatements,
} from '../../auth/credentials'
import { hash, hmac } from '../queue/crypto'
export async function provision(
  env: CloudflareBindings,
  actor: string,
  key: string,
  input: ProvisionInput,
) {
  const fingerprint = await hmac(
    await hash(env.BETTER_AUTH_SECRET),
    JSON.stringify(input),
  )
  const previous = await env.DB.prepare(
    'SELECT request_hash,result FROM provisioning_request WHERE actor_id=? AND request_key=?',
  )
    .bind(actor, key)
    .first<{ request_hash: string; result: string }>()
  if (previous) {
    if (previous.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    return JSON.parse(previous.result) as {
      organizationId: string
      venueId: string
      userId: string
    }
  }
  try {
    if (
      await env.DB.prepare('SELECT id FROM organization WHERE slug=?')
        .bind(input.slug)
        .first()
    )
      throw new HTTPException(409, { message: 'slug_unavailable' })
    const organizationId = crypto.randomUUID(),
      venueId = crypto.randomUUID(),
      userId = crypto.randomUUID()
    const result = { organizationId, venueId, userId }
    // A single D1 transaction: no partially active tenant and no compensation of tenant privileges.
    // Passwords are hashed with Better Auth; plaintext never enters idempotency results.
    const statements = [
      ...(await credentialStatements(
        env,
        userId,
        input.ownerName,
        input.ownerUsername,
        input.ownerPassword,
      )),
      env.DB.prepare(
        'INSERT INTO organization(id,name,slug,createdAt) VALUES (?,?,?,?)',
      ).bind(
        organizationId,
        input.organizationName,
        input.slug,
        new Date().toISOString(),
      ),
      env.DB.prepare(
        'INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)',
      ).bind(organizationId, actor),
      env.DB.prepare(
        'INSERT INTO venue(id,organization_id,name,timezone) VALUES (?,?,?,?)',
      ).bind(venueId, organizationId, input.venueName, input.timezone),
      ...input.services.map((service) =>
        env.DB.prepare(
          'INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,?,?,0,?,?)',
        ).bind(
          crypto.randomUUID(),
          venueId,
          service.capacity,
          service.averageMinutes,
          service.name,
          JSON.stringify(service),
        ),
      ),
      ...membershipStatements(env, userId, organizationId, venueId, 'owner'),
      audit(
        env,
        actor,
        organizationId,
        venueId,
        'tenant.provisioned',
        organizationId,
      ),
      env.DB.prepare(
        'INSERT INTO provisioning_request VALUES (?,?,?,?,?)',
      ).bind(actor, key, fingerprint, organizationId, JSON.stringify(result)),
    ]
    await env.DB.batch(statements)
    return result
  } catch (error) {
    const raced = await env.DB.prepare(
      'SELECT request_hash,result FROM provisioning_request WHERE actor_id=? AND request_key=?',
    )
      .bind(actor, key)
      .first<{ request_hash: string; result: string }>()
    if (raced && raced.request_hash === fingerprint)
      return JSON.parse(raced.result) as {
        organizationId: string
        venueId: string
        userId: string
      }
    if (
      await env.DB.prepare('SELECT id FROM organization WHERE slug=?')
        .bind(input.slug)
        .first()
    )
      throw new HTTPException(409, { message: 'slug_unavailable' })
    if (
      await env.DB.prepare('SELECT id FROM user WHERE username=?')
        .bind(input.ownerUsername)
        .first()
    )
      throw new HTTPException(409, { message: 'username_unavailable' })
    throw error
  }
}
