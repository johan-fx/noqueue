import { env } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'
import { app } from '../../app'
import { fixture } from '../../../test/whatsapp-v4-fixture'
import { directoryConfigStatement } from '../discovery/configuration'
import { publicSearchResponseSchema } from '@noqueue/contracts/discovery'

let secret: string, ip: string
beforeEach(() => { secret = crypto.randomUUID().replaceAll('-', '').repeat(2); ip = crypto.randomUUID() })
function request(body: unknown = {}, headers: Record<string, string> = {}, path = '/mobile/search', method = 'POST') {
  return app.request('https://app.example/api/v1' + path, {
    method, headers: { Origin: 'capacitor://localhost', Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  }, { ...env, WHATSAPP_ENABLED: 'false', MOBILE_PUSH_ENABLED: 'false' })
}
async function discoverable() {
  const f = await fixture()
  const row = await env.DB.prepare('SELECT venue_id,config FROM queue WHERE id=?').bind(f.queue).first<{ venue_id: string; config: string }>()
  await env.DB.batch([
    env.DB.prepare("UPDATE venue SET address_formatted='Calle local 1',location_attribution='[]',latitude=40,longitude=-3,location_confirmed_at=? WHERE id=?").bind(Date.now(), row!.venue_id),
    directoryConfigStatement(env, f.queue, row!.config),
  ])
  return { ...f, venue: row!.venue_id }
}
it('uses the web catalog with native auth and no WhatsApp, including venue and service reads', async () => {
  const f = await discoverable(), input = { recentIds: [f.queue] }
  const response = await request(input)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  const mobile = publicSearchResponseSchema.parse(await response.json())
  expect(mobile.items.map(i => i.id)).toEqual([f.queue])
  const web = await request(input, { Origin: env.PUBLIC_APP_ORIGIN, Authorization: '' }, '/public/search')
  expect(await web.json()).toEqual(mobile)
  expect((await request({}, {}, `/mobile/venues/${f.venue}/services`, 'GET')).status).toBe(200)
  expect((await request({}, {}, `/mobile/services/${f.queue}`, 'GET')).status).toBe(200)
  // No enrollment/contact side effects from discovering a venue.
  expect(await env.DB.prepare('SELECT 1 FROM queue_entry WHERE queue_id=?').bind(f.queue).first()).toBeNull()
  await env.DB.prepare("UPDATE tenant_account SET status='suspended' WHERE organization_id=(SELECT organization_id FROM venue WHERE id=?)").bind(f.venue).run()
  expect((await (await request(input)).json() as { items: unknown[] }).items).toEqual([])
  expect((await request({}, {}, `/mobile/venues/${f.venue}/services`, 'GET')).status).toBe(404)
})
it('allows both native preflights but preserves the public web origin guard', async () => {
  for (const Origin of ['capacitor://localhost', 'https://localhost']) {
    const preflight = await request({}, { Origin, Authorization: '', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }, '/mobile/search', 'OPTIONS')
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(Origin)
    expect((await request({}, { Origin })).status).toBe(200)
    expect((await request({}, { Origin }, '/public/search')).status).toBe(403)
  }
  expect((await request({}, { Origin: 'https://evil.example' })).status).toBe(403)
  expect((await request({}, { Authorization: '' })).status).toBe(401)
  expect((await request({}, { Authorization: 'Bearer invalid' })).status).toBe(401)
})
it('validates search and limits discovery independently of turn commands, even with rotated secrets', async () => {
  expect((await request({ text: 'a'.repeat(201) })).status).toBe(400)
  expect((await request({ text: 'a'.repeat(2049) })).status).toBe(413)
  for (let i = 2; i < 60; i++) {
    secret = crypto.randomUUID().replaceAll('-', '').repeat(2)
    expect((await request({ type: 'invalid' })).status).toBe(400)
  }
  expect((await request()).status).toBe(429)
  expect((await request({}, {}, '/mobile/entries', 'GET')).status).toBe(200)
  expect((await request({}, { 'Idempotency-Key': crypto.randomUUID() }, `/mobile/entries/${'00'.repeat(32)}/commands`)).status).toBe(400)
})
