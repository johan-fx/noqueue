import { isIPv6 } from 'node:net'
import { deriveClientIpAddress, expect, test } from '../fixtures.js'

function identity(overrides: Partial<Parameters<typeof deriveClientIpAddress>[0]> = {}) {
  return {
    projectName: 'chromium',
    testId: 'staff-auth-flow',
    repeatEachIndex: 0,
    retry: 0,
    clientLabel: 'primary',
    ...overrides,
  }
}

function prefix64(address: string) {
  return address.split(':').slice(0, 4).join(':')
}

test('derives stable valid ULA IPv6 /64 identities for isolated E2E clients', () => {
  const primary = deriveClientIpAddress(identity())
  expect(primary).toBe(deriveClientIpAddress(identity()))
  expect(isIPv6(primary)).toBe(true)
  expect(primary.split(':')[0]).toMatch(/^fd[0-9a-f]{2}$/)

  const variants = [
    identity({ projectName: 'firefox' }),
    identity({ testId: 'another-test' }),
    identity({ repeatEachIndex: 1 }),
    identity({ retry: 1 }),
    identity({ clientLabel: 'independent-guest' }),
  ].map((input) => prefix64(deriveClientIpAddress(input)))
  expect(new Set([prefix64(primary), ...variants]).size).toBe(variants.length + 1)
})
