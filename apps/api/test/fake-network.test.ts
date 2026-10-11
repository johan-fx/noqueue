import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { setupNetwork } from './fake-network'
const network = setupNetwork()
beforeAll(() => network.enable())
afterAll(() => network.disable())
afterEach(() => network.resetHandlers())
it('never bypasses an unhandled provider request to the real network', async () => {
  await expect(
    fetch('https://unhandled-provider.noqueue.invalid/messages', {
      method: 'POST',
    }),
  ).rejects.toThrow()
})
it.each([
  'https://waba-sandbox.360dialog.io/v1/messages',
  'https://waba-v2.360dialog.io/messages',
])('retains fake provider %s after handler reset', async (endpoint) => {
  network.resetHandlers()
  const response = await fetch(endpoint, { method: 'POST' })
  expect(response.status).toBe(201)
  expect(
    ((await response.json()) as { messages: { id: string }[] }).messages[0]?.id,
  ).toMatch(/^wamid.fake./)
})
