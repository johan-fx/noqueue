import { describe, expect, it } from 'vitest'
import { formatDays, readHours, writeHours } from './hours'

describe('service opening hours', () => {
  it('stores one schedule per selected day and shared range', () => {
    expect(
      writeHours([2, 0], [{ from: '12:00', to: '23:00' }]),
    ).toEqual([
      { day: 2, from: '12:00', to: '23:00' },
      { day: 0, from: '12:00', to: '23:00' },
    ])
  })

  it('rebuilds the shared ranges when every day matches', () => {
    expect(
      readHours([
        { day: 2, from: '12:00', to: '16:00' },
        { day: 3, from: '12:00', to: '16:00' },
        { day: 2, from: '20:00', to: '23:00' },
        { day: 3, from: '20:00', to: '23:00' },
      ]),
    ).toEqual({
      days: [2, 3],
      ranges: [
        { from: '12:00', to: '16:00' },
        { from: '20:00', to: '23:00' },
      ],
    })
  })

  it('labels a contiguous week span', () => {
    expect(formatDays([2, 3, 4, 5, 6, 0])).toBe('Martes - Domingo')
  })
})
