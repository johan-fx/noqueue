import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetManifest, verifyAssets } from './assets.mjs'

test('asset manifests bind bytes to commit and profile; stale or rebuilt assets fail', async () => {
  const expected = await assetManifest('general', 'sha', async () => 'digest')
  verifyAssets(expected, await assetManifest('general', 'sha', async () => 'digest'))
  for (const actual of [
    await assetManifest('general', 'other-sha', async () => 'digest'),
    await assetManifest('general', 'sha', async () => 'changed'),
    await assetManifest('production', 'sha', async () => 'digest'),
  ]) assert.throws(() => verifyAssets(expected, actual))
  await assert.rejects(assetManifest('unknown', 'sha'))
})
