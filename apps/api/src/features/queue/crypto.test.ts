import { expect, it } from 'vitest'
import {
  encryptDisplayName,
  decryptDisplayName,
  decryptPhone,
} from './crypto'
it('encrypts names using randomized ciphertext in a separate authentication domain', async () => {
  const key = '11'.repeat(32)
  const first = await encryptDisplayName(key, 'María'),
    second = await encryptDisplayName(key, 'María')
  expect(first).not.toBe(second)
  expect(first).not.toContain('María')
  expect(await decryptDisplayName(key, first)).toBe('María')
  await expect(decryptPhone(key, first)).rejects.toThrow()
})
