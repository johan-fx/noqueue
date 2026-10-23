import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkerServer, routeWorkerRequest } from '../../apps/api/scripts/http-worker.mjs'
import { verificationEnvironment } from './environment.mjs'

test('full verification executes opt-in cycle suites with isolated visual artifacts', () => {
  const parent = { NOQUEUE_E2E_AUTO_REPLACEMENT: 'false', REPLACEMENT_SCREENSHOTS: '/other-run' }
  const full = verificationEnvironment(parent, '/isolated/report', { all: true, extended: false })
  assert.equal(full.NOQUEUE_E2E_AUTO_REPLACEMENT, 'true')
  assert.equal(full.REPLACEMENT_SCREENSHOTS, '/isolated/report/cycle-screenshots')
  assert.equal(full.QUEUE_REPORT_DIR, '/isolated/report')
  assert.equal(full.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false')
  const standard = verificationEnvironment(parent, '/isolated/report', { all: false, extended: false })
  assert.equal(standard.NOQUEUE_E2E_AUTO_REPLACEMENT, 'false')
  assert.equal(parent.REPLACEMENT_SCREENSHOTS, '/other-run')
})
test('local worker persistence is exclusively allocated, never a shared wipe', async () => {
  const source = await readFile(
    new URL('../../apps/api/scripts/dev-e2e.mjs', import.meta.url),
    'utf8',
  )
  assert.match(source, /mkdtemp/)
  assert.doesNotMatch(source, /rm\(directory/)
})
test('browser defaults allocate a unique port and retain first failure traces', async () => {
  const source = await readFile(
    new URL('../../tests/e2e/playwright.config.ts', import.meta.url),
    'utf8',
  )
  assert.match(source, /listen\(0/)
  assert.match(source, /retain-on-failure/)
})

test('E2E HTTP bridge preserves bodies, identity, redirects and separate cookies without replay', async () => {
  const calls = []
  const server = createWorkerServer(async (url, init) => {
    const request = new Request(url, init)
    calls.push({ url, headers: request.headers, body: await request.text() })
    const headers = new Headers({ location: '/next?lang=es' })
    headers.append('set-cookie', 'session=one; HttpOnly; Path=/')
    headers.append('set-cookie', 'preference=two; Path=/')
    return new Response('redirect', { status: 303, headers })
  }, 'http://127.0.0.1:8787')
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/test?value=a%2Fb`, {
      method: 'POST', redirect: 'manual', body: 'unchanged body',
      headers: { origin: 'http://127.0.0.1:8787', cookie: 'session=original', 'idempotency-key': 'same-key' },
    })
    assert.equal(result.status, 303)
    assert.equal(await result.text(), 'redirect')
    assert.equal(result.headers.get('location'), '/next?lang=es')
    assert.deepEqual(result.headers.getSetCookie(), ['session=one; HttpOnly; Path=/', 'preference=two; Path=/'])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/test?value=a%2Fb')
    assert.equal(calls[0].body, 'unchanged body')
    assert.equal(calls[0].headers.get('cookie'), 'session=original')
    assert.equal(calls[0].headers.get('origin'), 'http://127.0.0.1:8787')
    assert.equal(calls[0].headers.get('idempotency-key'), 'same-key')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('E2E transport does not hide a conflict or retry a failed mutation', async () => {
  let calls = 0
  const server = createWorkerServer(async () => {
    calls++
    if (calls === 1) return Response.json({ error: 'version_conflict' }, { status: 409 })
    throw new Error('sensitive error must not reach response')
  }, 'http://127.0.0.1:8787')
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/commands`
    const conflict = await fetch(url, { method: 'POST' })
    assert.equal(conflict.status, 409)
    assert.deepEqual(await conflict.json(), { error: 'version_conflict' })
    const failure = await fetch(url, { method: 'POST' })
    assert.equal(failure.status, 500)
    assert.equal(await failure.text(), 'Local test worker dispatch failed')
    assert.equal(calls, 2)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('direct runtime transport retains Worker-first assets and SPA routing', async () => {
  const calls = []
  const target = (name) => ({ fetch: async (url) => { calls.push([name, new URL(url).pathname]); return new Response(name) } })
  const dispatch = routeWorkerRequest(['/api/*', '/assets/*'], target('worker'), target('assets'))
  for (const path of ['/api/v1/staff/me', '/assets/missing.js', '/login', '/staff', '/sw.js']) {
    await dispatch('http://localhost:8787' + path)
  }
  assert.deepEqual(calls, [
    ['worker', '/api/v1/staff/me'], ['worker', '/assets/missing.js'],
    ['assets', '/login'], ['assets', '/staff'], ['assets', '/sw.js'],
  ])
  assert.throws(() => routeWorkerRequest(['*'], target('worker'), target('assets')), /Unsupported/)
})
