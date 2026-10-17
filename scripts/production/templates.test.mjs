import test from 'node:test'
import assert from 'node:assert/strict'
import { productionURLUpdate } from './templates.mjs'
test('production URL edit is narrow, idempotent and preserves copy/category/button order', () => {
  const source = { name: 'noqueue_v4_ready_en_production', language: 'en_US', category: 'MARKETING', components: [
    { type: 'BODY', text: 'Unchanged {{1}}', example: { body_text: [['synthetic']] } },
    { type: 'FOOTER', text: 'Reply STOP' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Pass' }, { type: 'URL', text: 'View', url: 'https://noqueue-app.com/t/{{1}}', example: ['https://noqueue-app.com/t/SYNTHETIC'] }] },
  ] }
  const next = productionURLUpdate(source)
  assert.equal(next.changed, true)
  assert.deepEqual(next.components.slice(0, 2), source.components.slice(0, 2))
  assert.deepEqual(next.components[2].buttons[0], source.components[2].buttons[0])
  assert.equal(next.components[2].buttons[1].url, 'https://app.noqueue-app.com/t/{{1}}')
  assert.equal(source.components[2].buttons[1].url, 'https://noqueue-app.com/t/{{1}}')
  assert.equal(productionURLUpdate({ ...source, components: next.components }).changed, false)
  assert.throws(() => productionURLUpdate({ ...source, name: 'noqueue_v4_ready_en_staging' }))
  assert.throws(() => productionURLUpdate({ ...source, components: [{ type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://unrelated.invalid/t/{{1}}' }] }] }))
})
