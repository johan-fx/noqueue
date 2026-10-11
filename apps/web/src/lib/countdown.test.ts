import { expect, it } from 'vitest'
import { formatCountdown } from './countdown'

it.each([
  [60000, '1:00'], [59000, '0:59'], [59999, '1:00'],
  [1001, '0:02'], [999, '0:01'], [1, '0:01'], [0, '0:00'],
  [-1000, '0:00'], [3600000, '60:00'], [null, '—'], [NaN, '—'],
  [Infinity, '—'],
])('formats %s milliseconds as %s', (ms, expected) => {
  expect(formatCountdown(ms)).toBe(expected)
})
