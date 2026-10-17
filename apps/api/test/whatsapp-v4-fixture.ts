import { env } from 'cloudflare:workers'
import { expect } from 'vitest'
import { manualConsentVersion, publicServiceConsentVersion } from '@noqueue/contracts/queue'
import { joinQueue } from '../src/features/queue/entries'

export async function fixture() {
  const actor = crypto.randomUUID(), org = crypto.randomUUID(), venue = crypto.randomUUID(), queue = crypto.randomUUID()
  const config = {
    name: 'Example reception', type: 'reception', capacity: 99, averageMinutes: 30,
    graceMinutes: 5, cutoffMinutes: 0, twentyFourHours: true, schedules: [],
    receptionServices: ['check_in'], estimationMode: 'active', resourceStateKnown: true,
    approachTurns: 0, approachMinutes: 0, stations: 1, spaces: [],
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,\'now\',\'now\')').bind(actor, 'Example owner', `${actor}@test.invalid`),
    env.DB.prepare('INSERT INTO organization(id,name) VALUES (?,?)').bind(org, 'Example organization'),
    env.DB.prepare('INSERT INTO tenant_account(organization_id,created_by) VALUES (?,?)').bind(org, actor),
    env.DB.prepare('INSERT INTO venue(id,organization_id,name) VALUES (?,?,?)').bind(venue, org, 'Example venue'),
    env.DB.prepare('INSERT INTO member(id,organizationId,userId,role,createdAt) VALUES (?,?,?,\'owner\',\'now\')').bind(crypto.randomUUID(), org, actor),
    env.DB.prepare('INSERT INTO venue_membership(user_id,venue_id,role) VALUES (?,?,\'owner\')').bind(actor, venue),
    env.DB.prepare('INSERT INTO queue(id,venue_id,capacity,average_minutes,open,name,config) VALUES (?,?,99,30,1,\'Reception\',?)').bind(queue, venue, JSON.stringify(config)),
  ])
  return { actor, queue }
}
export async function join(bindings: CloudflareBindings, queue: string, locale: 'es' | 'en', phone: string, actor?: string) {
  const result = await joinQueue(bindings, queue, crypto.randomUUID(), {
    displayName: 'Example customer', receptionService: 'check_in', partySize: 1, locale,
    whatsapp: { consent: true, phone, version: actor ? manualConsentVersion : publicServiceConsentVersion },
  }, false, actor, actor ? 'legacy' : 'public-service')
  expect(result.status).toBe(201)
  const notice = await env.DB.prepare('SELECT n.id,n.entry_id FROM notification_outbox n JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=? AND n.kind=\'queue_joined\' ORDER BY n.rowid DESC LIMIT 1')
    .bind(queue).first<{
    id: string
    entry_id: string
  }>()
  if (!notice)
    throw new Error('Missing committed join notice')
  return notice
}
export async function status(id: string) {
  return env.DB.prepare('SELECT status,attempts FROM notification_outbox WHERE id=?').bind(id).first()
}
