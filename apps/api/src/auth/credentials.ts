import { hashPassword } from 'better-auth/crypto'
import type { StaffRole } from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'

// Build identities and grants together in the caller's D1 batch: no orphan account on failure.
export async function credentialStatements(
  env: CloudflareBindings,
  id: string,
  name: string,
  username: string,
  password: string,
) {
  if (
    await env.DB.prepare('SELECT id FROM user WHERE username=?')
      .bind(username)
      .first()
  )
    throw new HTTPException(409, { message: 'username_unavailable' })
  const now = new Date().toISOString()
  const digest = await hashPassword(password)
  return [
    env.DB.prepare(
      'INSERT INTO user(id,name,email,username,displayUsername,emailVerified,createdAt,updatedAt,role) VALUES (?,?,?,?,?,0,?,?,?)',
    ).bind(
      id,
      name,
      `${id}@accounts.noqueue.invalid`,
      username,
      username,
      now,
      now,
      'user',
    ),
    env.DB.prepare(
      'INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
    ).bind(crypto.randomUUID(), id, 'credential', id, digest, now, now),
  ]
}
export function membershipStatements(
  env: CloudflareBindings,
  user: string,
  org: string,
  venue: string,
  role: StaffRole,
) {
  return [
    env.DB.prepare(
      'INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      org,
      user,
      role === 'owner' ? 'owner' : 'member',
      new Date().toISOString(),
    ),
    env.DB.prepare(
      'INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,?)',
    ).bind(user, venue, role),
  ]
}
