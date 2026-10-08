import { describe, it, expect } from 'vitest'
import {
  serviceSchema,
  storedServiceSchema,
  roleCapabilities,
  inviteSchema,
  memberDetailsSchema,
  provisionSchema,
} from './staff'
const service = {
  name: 'Restaurant',
  type: 'restaurant',
  capacity: 20,
  averageMinutes: 30,
  graceMinutes: 5,
  cutoffMinutes: 0,
  twentyFourHours: false,
  schedules: [{ day: 1, from: '12:00', to: '23:00' }],
  spaces: [{ name: 'Interior', tables: 10 }],
  receptionServices: [],
}
describe('staff contracts', () => {
  it('rejects overlapping and overnight ranges', () => {
    expect(
      serviceSchema.safeParse({
        ...service,
        schedules: [
          ...service.schedules,
          { day: 1, from: '14:00', to: '16:00' },
        ],
      }).success,
    ).toBe(false)
    expect(
      serviceSchema.safeParse({
        ...service,
        schedules: [{ day: 1, from: '23:00', to: '02:00' }],
      }).success,
    ).toBe(false)
  })
  it('requires operational settings by service type', () => {
    expect(serviceSchema.safeParse(service).success).toBe(true)
    expect(serviceSchema.safeParse({ ...service, spaces: [] }).success).toBe(
      false,
    )
    expect(
      serviceSchema.safeParse({
        ...service,
        type: 'reception',
        receptionServices: [],
      }).success,
    ).toBe(false)
    expect(
      serviceSchema.safeParse({ ...service, type: 'pool', spaces: [] }).success,
    ).toBe(true)
  })
  it('defaults material ETA notice thresholds for stored services and validates overrides', () => {
    expect(storedServiceSchema.parse(service)).toMatchObject({
      graceMinutes: 5,
      etaChangeThresholdMinutes: 5,
      notificationCooldownMinutes: 10,
    })
    expect(
      serviceSchema.safeParse({ ...service, etaChangeThresholdMinutes: 0 })
        .success,
    ).toBe(false)
    expect(
      serviceSchema.safeParse({ ...service, notificationCooldownMinutes: 121 })
        .success,
    ).toBe(false)
  })
  it('keeps old spaces valid and checks that table types add up', () => {
    expect(serviceSchema.safeParse(service).success).toBe(true)
    expect(
      serviceSchema.safeParse({
        ...service,
        spaces: [
          {
            name: 'Interior',
            tables: 6,
            tableTypes: [
              { seats: 2, count: 4 },
              { seats: 4, count: 2 },
            ],
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      serviceSchema.safeParse({
        ...service,
        spaces: [
          {
            name: 'Interior',
            tables: 10,
            tableTypes: [{ seats: 2, count: 4 }],
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      serviceSchema.safeParse({
        ...service,
        spaces: [
          {
            name: 'Interior',
            tables: 2,
            tableTypes: [
              { seats: 2, count: 1 },
              { seats: 2, count: 1 },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })
  it('keeps per-seat queue settings optional and unique', () => {
    expect(serviceSchema.safeParse(service).success).toBe(true)
    expect(
      serviceSchema.safeParse({
        ...service,
        queueBySeat: [
          { seats: 2, averageMinutes: 50, capacity: 10 },
          { seats: 4, averageMinutes: 70, capacity: 6 },
        ],
      }).success,
    ).toBe(true)
    expect(
      serviceSchema.safeParse({
        ...service,
        queueBySeat: [
          { seats: 2, averageMinutes: 50, capacity: 10 },
          { seats: 2, averageMinutes: 40, capacity: 4 },
        ],
      }).success,
    ).toBe(false)
  })
  it('cannot invite an owner or platform administrator through staff invitations', () => {
    for (const role of ['owner', 'platform_admin', 'commercial_operator'])
      expect(
        inviteSchema.safeParse({
          name: 'Test',
          username: 'test.user',
          password: 'testing-password-123',
          role,
        }).success,
      ).toBe(false)
    expect(roleCapabilities.queue_staff).not.toContain('queue.configure')
    expect(roleCapabilities.viewer).toEqual(['queue.read'])
  })
  it('normalizes username and validates time zones', () => {
    const data = {
      locationToken: 'verified-token',
      locationOperationId: '00000000-0000-4000-8000-000000000000',
      organizationName: 'Hotel',
      slug: 'hotel-one',
      venueName: 'Hotel',
      ownerName: 'Owner',
      ownerUsername: 'OWNER',
      ownerPassword: 'testing-password-123',
      timezone: 'Europe/Madrid',
      services: [service],
    }
    expect(provisionSchema.parse(data).ownerUsername).toBe('owner')
    expect(
      provisionSchema.safeParse({ ...data, timezone: 'invalid' }).success,
    ).toBe(false)
  })
})

it('preserves stable group identity, per-space means and safe rollout settings', () => {
  const parsed = serviceSchema.parse({
    ...service,
    estimationMode: 'active',
    resourceStateKnown: true,
    spaces: [
      {
        id: 'terrace',
        name: 'Terrace',
        tables: 1,
        tableTypes: [{ seats: 4, count: 1, averageMinutes: 70 }],
      },
    ],
  })
  expect(parsed.spaces[0]).toMatchObject({
    id: 'terrace',
    tableTypes: [{ averageMinutes: 70 }],
  })
  expect(parsed).toMatchObject({
    estimationMode: 'active',
    resourceStateKnown: true,
  })
})
it('accepts bounded availability blocks while retaining legacy duration adjustment shape', () => {
  const base = {
    spaceId: 'room',
    seats: 4,
    reason: 'Cleaning',
    expiresAt: Date.now() + 60000,
  }
  expect(
    serviceSchema.parse({
      ...service,
      adjustments: [{ ...base, kind: 'availability' }],
    }).adjustments?.[0],
  ).toMatchObject({ kind: 'availability' })
  expect(
    serviceSchema.parse({ ...service, adjustments: [{ ...base, minutes: 45 }] })
      .adjustments?.[0],
  ).toMatchObject({ minutes: 45 })
})

describe('member details', () => {
  it('reuses invitation identity validation without requiring a password', () => {
    expect(
      memberDetailsSchema.parse({
        name: ' Staff ',
        username: ' New.Staff ',
        role: 'viewer',
      }),
    ).toEqual({ name: 'Staff', username: 'new.staff', role: 'viewer' })
    for (const input of [
      { name: '', username: 'validuser', role: 'viewer' },
      { name: 'Staff', username: 'a', role: 'viewer' },
      { name: 'Staff', username: 'validuser', role: 'owner' },
    ])
      expect(memberDetailsSchema.safeParse(input).success).toBe(false)
  })
})
