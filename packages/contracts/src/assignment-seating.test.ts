import { describe, expect, it } from 'vitest'
import {
  assignmentTableOptions,
  defaultAssignmentSeating,
  entryCommandSchema,
  type ServiceInput,
} from './staff'
const config = {
  type: 'restaurant',
  spaces: [
    {
      id: 'room',
      name: 'Interior',
      tables: 2,
      tableTypes: [
        { seats: 4, count: 1 },
        { seats: 3, count: 1 },
      ],
    },
    {
      id: 'terrace',
      name: 'Terraza',
      tables: 1,
      tableTypes: [{ seats: 4, count: 1 }],
    },
  ],
} as ServiceInput

describe('assignment catalogue context', () => {
  it('sorts capacities that fit and never treats quantities as availability', () => {
    expect(assignmentTableOptions(config, 2)[0]?.seats).toEqual([3, 4])
    expect(assignmentTableOptions(config, 4)[0]?.seats).toEqual([4])
    expect(assignmentTableOptions(config, 5)).toEqual([])
  })
  it('defaults to preference, only unambiguous space or explicit exception', () => {
    expect(
      defaultAssignmentSeating(config, {
        partySize: 2,
        preferredSpaceId: 'room',
      }),
    ).toEqual({ mode: 'confirmed', spaceId: 'room', seats: 3 })
    for (const preferredSpaceId of [undefined, 'fastest', 'removed'])
      expect(
        defaultAssignmentSeating(config, { partySize: 2, preferredSpaceId }),
      ).toBeNull()
    expect(
      defaultAssignmentSeating(
        { ...config, spaces: config.spaces.slice(0, 1) },
        { partySize: 2 },
      ),
    ).toEqual({ mode: 'confirmed', spaceId: 'room', seats: 3 })
    expect(defaultAssignmentSeating(config, { partySize: 5 })).toEqual({
      mode: 'unspecified',
    })
    expect(
      defaultAssignmentSeating(
        { ...config, spaces: [{ name: 'Legacy', tables: 10 }] },
        { partySize: 2 },
      ),
    ).toEqual({ mode: 'unspecified' })
  })
  it('accepts old calls but rejects incomplete, ambiguous and non-call seating', () => {
    const command = {
      action: 'call',
      entryId: '00000000-0000-4000-8000-000000000000',
      version: 0,
    }
    for (const seating of [
      undefined,
      { mode: 'unspecified' },
      { mode: 'confirmed', spaceId: 'room', seats: 4 },
    ])
      expect(
        entryCommandSchema.safeParse({ ...command, seating }).success,
      ).toBe(true)
    for (const seating of [
      { spaceId: 'room', seats: 4 },
      { mode: 'confirmed', spaceId: 'room' },
      { mode: 'confirmed', spaceId: 'room', seats: 0 },
      { mode: 'confirmed', spaceId: 'room', seats: 2.5 },
      { mode: 'unspecified', seats: 4 },
    ])
      expect(
        entryCommandSchema.safeParse({ ...command, seating }).success,
      ).toBe(false)
    expect(
      entryCommandSchema.safeParse({
        ...command,
        action: 'complete',
        seating: { mode: 'unspecified' },
      }).success,
    ).toBe(false)
  })
})
