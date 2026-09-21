import { z } from 'zod'
export const staffRoleSchema = z.enum([
  'owner',
  'venue_manager',
  'queue_staff',
  'viewer',
])
export type StaffRole = z.infer<typeof staffRoleSchema>
export const capabilities = [
  'queue.read',
  'queue.operate',
  'queue.configure',
  'members.manage',
] as const
export type Capability = (typeof capabilities)[number]
export const roleCapabilities: Record<StaffRole, readonly Capability[]> = {
  owner: capabilities,
  venue_manager: ['queue.read', 'queue.operate', 'queue.configure'],
  queue_staff: ['queue.read', 'queue.operate'],
  viewer: ['queue.read'],
}
export const emailSchema = z.email().trim().toLowerCase().max(254)
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_.]+$/)
export const passwordSchema = z.string().min(15).max(128)
const name = z.string().trim().min(2).max(100)
export const scheduleSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .refine((v) => v.from < v.to, {
    message: 'Use separate ranges for overnight hours',
    path: ['to'],
  })
export const serviceSchema = z
  .object({
    name,
    type: z.enum(['restaurant', 'reception', 'pool']),
    capacity: z.number().int().min(1).max(10000),
    averageMinutes: z.number().int().min(1).max(1440),
    graceMinutes: z.number().int().min(1).max(120),
    cutoffMinutes: z.number().int().min(0).max(240),
    twentyFourHours: z.boolean(),
    schedules: z.array(scheduleSchema).max(28),
    spaces: z
      .array(z.object({ name, tables: z.number().int().min(1).max(1000) }))
      .max(30),
    receptionServices: z
      .array(z.enum(['check_in', 'check_out', 'other']))
      .max(3),
    // Optional so queues saved before the wizard still parse.
    // `fastest` means assign the space with the shortest wait.
    assignmentPreference: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.twentyFourHours && !v.schedules.length)
      ctx.addIssue({
        code: 'custom',
        path: ['schedules'],
        message: 'Add opening hours',
      })
    for (let i = 0; i < v.schedules.length; i++)
      for (let j = 0; j < i; j++) {
        const a = v.schedules[i]!,
          b = v.schedules[j]!
        if (a.day === b.day && a.from < b.to && b.from < a.to)
          ctx.addIssue({
            code: 'custom',
            path: ['schedules', i],
            message: 'Overlapping hours',
          })
      }
    if (v.type === 'restaurant' && !v.spaces.length)
      ctx.addIssue({
        code: 'custom',
        path: ['spaces'],
        message: 'Add a space',
      })
    if (v.type === 'reception' && !v.receptionServices.length)
      ctx.addIssue({
        code: 'custom',
        path: ['receptionServices'],
        message: 'Select a reception service',
      })
  })
export type ServiceInput = z.infer<typeof serviceSchema>
export const provisionSchema = z.object({
  organizationName: name,
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(60),
  venueName: name,
  timezone: z
    .string()
    .max(80)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: v })
        return true
      } catch {
        return false
      }
    }, 'Invalid time zone'),
  ownerName: name,
  ownerUsername: usernameSchema,
  ownerPassword: passwordSchema,
  services: z.array(serviceSchema).min(1).max(10),
})
export type ProvisionInput = z.infer<typeof provisionSchema>
export const inviteSchema = z.object({
  name,
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['venue_manager', 'queue_staff', 'viewer']),
})
export const queueCommandSchema = z.object({
  entryId: z.string().uuid(),
  version: z.number().int().min(0),
  action: z.enum(['call', 'complete', 'cancel', 'no_show', 'skip']),
})
export type QueueCommand = z.infer<typeof queueCommandSchema>
export const queueSettingsSchema = serviceSchema.extend({
  version: z.number().int().min(0),
  open: z.boolean(),
})
export const membershipUpdateSchema = z.object({
  role: z.enum(['venue_manager', 'queue_staff', 'viewer']),
  active: z.boolean(),
})
export type VenueSummary = {
  id: string
  name: string
  organizationId: string
  organizationName: string
  role: StaffRole
}
export type QueueSummary = {
  id: string
  name: string
  venueId: string
  capacity: number
  averageMinutes: number
  open: number
  version: number
  config: ServiceInput
}
export type StaffEntry = {
  id: string
  code: string
  partySize: number
  status: string
  sequence: number
  version: number
  calledAt: number | null
}
