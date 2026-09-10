import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Capacitor points to the shared Vite build', async () => {
  const configPath = fileURLToPath(new URL('../capacitor.config.ts', import.meta.url))
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(configPath, 'utf8'),
  )

  assert.match(source, /webDir:\s*['"]\.\.\/web\/dist['"]/) 
  assert.equal(existsSync(configPath), true)
})
