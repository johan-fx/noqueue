import test from 'node:test'
import assert from 'node:assert/strict'
import { productionD1 } from '../../apps/api/scripts/production-d1.mjs'
const identity = { accountId: 'a'.repeat(32), databaseId: 'b'.repeat(8)+'-bbbb-bbbb-bbbb-'+'b'.repeat(12), token: 'synthetic-token' }
test('D1 query client returns SELECT rows, submits SQL only in HTTPS body', async () => {
  const execute = productionD1({ ...identity, request: async (url, options) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${identity.accountId}/d1/database/${identity.databaseId}/query`)
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), { sql: 'SELECT 1 AS n' })
    return Response.json({ success: true, result: [{ success: true, results: [{ n: 1 }] }] })
  } })
  assert.deepEqual(await execute('SELECT 1 AS n'), [{ success: true, results: [{ n: 1 }] }])
})
test('D1 client sanitizes network, parse, provider and statement errors', async () => {
  for (const request of [
    async () => { throw new Error('synthetic-private-sql') },
    async () => new Response('synthetic-private-sql'),
    async () => Response.json({ success: false, errors: [{ message: 'synthetic-private-sql' }] }),
    async () => Response.json({ success: true, result: [{ success: false, error: 'synthetic-private-sql' }] }),
  ]) {
    await assert.rejects(productionD1({ ...identity, request })('private-sql'), (error) => !error.message.includes('synthetic-private-sql') && /D1/.test(error.message))
  }
})
