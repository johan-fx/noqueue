import { describe, it, expect } from 'vitest'
import {
  serviceSchema,
  roleCapabilities,
  inviteSchema,
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
