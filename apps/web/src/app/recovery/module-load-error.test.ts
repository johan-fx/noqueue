import { expect, it } from 'vitest'
import { isModuleLoadError } from './module-load-error'

it.each([
  'Failed to fetch dynamically imported module: https://example.com/assets/PublicQueue-old.js',
  'error loading dynamically imported module: https://example.com/assets/PublicQueue-old.js',
  'Importing a module script failed.',
  'Loading chunk 23 failed.\n(error: https://example.com/assets/old.js)',
  'Loading CSS chunk 23 failed.',
  'Unable to preload CSS for /assets/old.css',
])('recognises browser module loading failure: %s', (message) => {
  expect(isModuleLoadError(new TypeError(message))).toBe(true)
})

it.each([null, undefined, 'Failed to fetch', {}, { message: 12 }, new TypeError('Failed to fetch'), new Error('Permission denied'), new TypeError('Cannot read properties of undefined')])(
  'does not label an unrelated error as a deployment problem: %s', (error) => {
    expect(isModuleLoadError(error)).toBe(false)
  },
)
