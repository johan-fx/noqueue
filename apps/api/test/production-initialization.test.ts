import { env } from 'cloudflare:workers'
import { it, expect } from 'vitest'
import { initialAdminStatements } from '../scripts/production-initialization.mjs'
it('D1 executes atomic initial cleanup + credential and keeps repeated bootstrap idempotent', async () => {
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()
  const initial = initialAdminStatements({ username: 'production.admin', name: 'Initial Admin', passwordHash: 'synthetic-hash', tables: tables.results.map((r) => r.name) })
  await env.DB.prepare(initial.create).run()
  try {
    await env.DB.prepare(initial.insert).run()
    await env.DB.prepare(initial.insert).run()
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM user').first()).toEqual({ n: 1 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM account').first()).toEqual({ n: 1 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM queue').first()).toEqual({ n: 0 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM service_search').first()).toEqual({ n: 0 })
    expect(await env.DB.prepare(initial.verify).first()).toMatchObject({ role: 'platform_admin', credentials: 1, banned: 0 })
  } finally { await env.DB.prepare(initial.drop).run() }
})
