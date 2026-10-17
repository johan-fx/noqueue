import test from 'node:test'
import assert from 'node:assert/strict'
import { productionURLUpdate, effectiveTemplateInventory, assertTemplatesApproved } from './templates.mjs'
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

test('effective inventory rejects cached approval after a Meta edit', async () => {
  const cached = { external_id: '123', name: 'noqueue_v4_approaching_es', language: 'es_ES', status: 'approved' }
  const live = { id: '123', name: cached.name, language: cached.language, status: 'PENDING', components: [] }
  const rows = await effectiveTemplateInventory([cached], async path => {
    assert.equal(path, '/message_templates/123')
    return live
  })
  assert.equal(rows[0].status, 'PENDING')
  assert.equal(rows[0].cachedStatus, 'approved')
  await assert.rejects(effectiveTemplateInventory([cached], async () => ({ ...live, language: 'en_US' })))
  await assert.rejects(effectiveTemplateInventory([cached], async () => ({ ...live, id: '456' })))
  await assert.rejects(effectiveTemplateInventory([cached], async () => { throw Error('unavailable') }))
})

test('approval gate requires every distinct effective template, with correct production URLs', () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ name: 'shared_' + i, status: 'APPROVED', components: [] }))
  assert.doesNotThrow(() => assertTemplatesApproved(rows))
  assert.throws(() => assertTemplatesApproved(rows.slice(1)))
  assert.throws(() => assertTemplatesApproved([...rows.slice(1), rows[1]]))
  for (const status of ['PENDING', 'REJECTED', 'PAUSED', 'approved', undefined])
    assert.throws(() => assertTemplatesApproved([{ ...rows[0], status }, ...rows.slice(1)]))
  const prod = { name: 'noqueue_v4_ready_en_production', language: 'en_US', status: 'APPROVED', components: [{ type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://noqueue-app.com/t/{{1}}' }] }] }
  assert.throws(() => assertTemplatesApproved([prod, ...rows.slice(1)]))
  assert.doesNotThrow(() => assertTemplatesApproved([{ ...prod, components: productionURLUpdate(prod).components }, ...rows.slice(1)]))
})
