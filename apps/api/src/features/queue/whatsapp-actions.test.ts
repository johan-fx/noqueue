import { expect, it } from 'vitest'
import {
  renderWhatsAppActionError,
  renderWhatsAppActionResult,
  renderWhatsAppActionSelectorLabel,
  signWhatsAppAction,
} from './whatsapp-actions'

it('keeps action ids stable across ETA revisions but binds them to notice lifecycle', async () => {
  const context = {
    notificationId: 'notice-1',
    entryId: 'entry-1',
    action: 'yield' as const,
    phase: 'waiting' as const,
    callCycle: 0,
    expiresAt: 2_000_000,
  }
  const secret = 'a'.repeat(64)
  const first = await signWhatsAppAction(secret, context)
  const sameNotice = await signWhatsAppAction(secret, context)
  const otherAction = await signWhatsAppAction(secret, {
    ...context,
    action: 'cancel',
  })
  const otherCycle = await signWhatsAppAction(secret, {
    ...context,
    phase: 'called',
    callCycle: 1,
  })
  expect(first).toMatch(/^wa1\.y\.[a-f0-9]{64}$/)
  expect(sameNotice).toBe(first)
  expect(otherAction).not.toBe(first)
  expect(otherCycle).not.toBe(first)
})

it('returns channel-appropriate result copy for called handoff, return-to-waiting, and rejected yield', () => {
  expect(renderWhatsAppActionResult('es', 'yield', 'called_handoff')).toBe(
    '*Has pasado el turno.* La plaza se ha ofrecido a la siguiente persona compatible.',
  )
  expect(renderWhatsAppActionResult('es', 'yield', 'returned_to_waiting')).toBe(
    '*Has pasado el turno* y has vuelto a esperar en tu *misma posición*.',
  )
  expect(renderWhatsAppActionResult('en', 'yield', 'called_handoff')).toBe(
    '*You passed your turn.* The place has been offered to the next compatible party.',
  )
  expect(renderWhatsAppActionResult('en', 'yield', 'returned_to_waiting')).toBe(
    '*You passed your turn* and are waiting again in your *same position*.',
  )
  expect(renderWhatsAppActionError('en', 'no_compatible_successor')).toContain(
    'your place has not changed',
  )
})

it('uses short standalone CTA labels in both supported locales', () => {
  expect(renderWhatsAppActionSelectorLabel('es')).toBe('Elegir lista')
  expect(renderWhatsAppActionSelectorLabel('en')).toBe('Choose a list')
  expect(renderWhatsAppActionSelectorLabel('es').length).toBeLessThanOrEqual(20)
  expect(renderWhatsAppActionSelectorLabel('en').length).toBeLessThanOrEqual(20)
})
