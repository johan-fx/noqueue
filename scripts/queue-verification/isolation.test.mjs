import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
