import type { AdmissionStatus } from './queue'
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
// Optional breakdown of a space. Absent on queues saved before this field existed.
const tableTypeSchema = z.object({
  seats: z.number().int().min(1).max(100),
  count: z.number().int().min(1).max(1000),
  averageMinutes: z.number().int().min(1).max(1440).optional(),
})
export const spaceSchema = z
  .object({
    id: z.string().min(1).max(100).optional(),
    name,
    tables: z.number().int().min(1).max(1000),
    tableTypes: z.array(tableTypeSchema).max(20).optional(),
  })
  .superRefine((space, ctx) => {
    const types = space.tableTypes
    if (!types?.length) return
    const seen = new Set<number>()
    for (const item of types) {
      if (seen.has(item.seats)) {
        ctx.addIssue({
          code: 'custom',
          path: ['tableTypes'],
          message: 'Duplicate table size',
        })
        return
      }
      seen.add(item.seats)
    }
    const total = types.reduce((sum, item) => sum + item.count, 0)
    if (total !== space.tables)
      ctx.addIssue({
        code: 'custom',
        path: ['tables'],
        message: 'Table types must add up to the space total',
      })
  })
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
    approachTurns: z.number().int().min(0).max(100).optional(),
    approachMinutes: z.number().int().min(0).max(1440).optional(),
    graceMinutes: z.number().int().min(1).max(120),
    cutoffMinutes: z.number().int().min(0).max(240),
    twentyFourHours: z.boolean(),
    schedules: z.array(scheduleSchema).max(28),
    reminder: z
      .object({
        enabled: z.boolean(),
        dailyAt: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .optional(),
        intervals: z
          .array(
            z.object({
              day: z.number().int().min(0).max(6),
              from: z.string(),
              to: z.string(),
              at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            }),
          )
          .max(28),
      })
      .optional(),
    spaces: z.array(spaceSchema).max(30),
    intelligencePolicy: z.enum(['automatic', 'disabled']).optional(),
    estimationMode: z.enum(['shadow', 'active']).optional(),
    resourceStateKnown: z.boolean().optional(),
    stations: z.number().int().min(1).max(1000).optional(),
    adjustments: z
      .array(
        z.union([
          z.object({
            kind: z.literal('duration').optional(),
            spaceId: z.string().min(1),
            seats: z.number().int().min(1).max(100),
            minutes: z.number().int().min(1).max(1440),
            reason: z.string().trim().min(3).max(300),
            expiresAt: z.number().int().positive(),
          }),
          z.object({
            kind: z.literal('availability'),
            spaceId: z.string().min(1),
            seats: z.number().int().min(1).max(100),
            reason: z.string().trim().min(3).max(300),
            expiresAt: z.number().int().positive(),
          }),
        ]),
      )
      .max(40)
      .optional(),
    receptionServices: z
      .array(z.enum(['check_in', 'check_out', 'other']))
      .max(3),
    // Optional so queues saved before the wizard still parse.
    // `fastest` means assign the space with the shortest wait.
    assignmentPreference: z.string().trim().min(1).max(100).optional(),
    // Per table size. Absent means the global average and capacity apply.
    queueBySeat: z
      .array(
        z.object({
          seats: z.number().int().min(1).max(100),
          averageMinutes: z.number().int().min(1).max(1440),
          capacity: z.number().int().min(1).max(10000),
        }),
      )
      .max(40)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.twentyFourHours && !v.schedules.length)
      ctx.addIssue({
        code: 'custom',
        path: ['schedules'],
        message: 'Add opening hours',
      })
    if (v.reminder?.enabled) {
      const time = (value: string) =>
        Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
      if (v.type !== 'restaurant' || (v.twentyFourHours && !v.reminder.dailyAt))
        ctx.addIssue({
          code: 'custom',
          path: ['reminder'],
          message: 'Restaurant reminder requires a valid time',
        })
      const keys = new Set<string>()
      for (const reminder of v.reminder.intervals) {
        const interval = v.schedules.find(
          (s) =>
            s.day === reminder.day &&
            s.from === reminder.from &&
            s.to === reminder.to,
        )
        const key = JSON.stringify([reminder.day, reminder.from, reminder.to])
        if (
          !interval ||
          keys.has(key) ||
          time(reminder.at) < time(interval.from) ||
          time(reminder.at) >= time(interval.to) - v.cutoffMinutes
        )
          ctx.addIssue({
            code: 'custom',
            path: ['reminder'],
            message:
              'Reminder must belong to one opening interval before cutoff',
          })
        keys.add(key)
      }
    }
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
    const ids = v.spaces.flatMap((s) => (s.id ? [s.id] : []))
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['spaces'],
        message: 'Duplicate space identity',
      })
    const seenSeats = new Set<number>()
    for (const item of v.queueBySeat ?? []) {
      if (seenSeats.has(item.seats)) {
        ctx.addIssue({
          code: 'custom',
          path: ['queueBySeat'],
          message: 'Duplicate table size',
        })
        return
      }
      seenSeats.add(item.seats)
    }
  })
export type ServiceInput = z.infer<typeof serviceSchema>
export const provisionSchema = z.object({
  locationToken: z.string().min(1).max(6000),
  locationOperationId: z.uuid(),
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
export const memberDetailsSchema = inviteSchema.omit({ password: true })
export type MemberDetailsInput = z.infer<typeof memberDetailsSchema>
export type StaffMember = {
  id: string
  name: string
  username: string
  role: StaffRole
  active: number
  canEditDetails: boolean
}
export const queueCommandSchema = z.object({
  entryId: z.string().uuid(),
  version: z.number().int().min(0),
  action: z.enum([
    'call',
    'complete',
    'release',
    'cancel',
    'no_show',
    'skip',
    'restore',
  ]),
  overrideReason: z.string().trim().min(3).max(300).optional(),
})
export type QueueCommand = z.infer<typeof queueCommandSchema>
export const queueSettingsSchema = serviceSchema.extend({
  version: z.number().int().min(0),
  open: z.boolean(),
  applyApproachToActive: z.boolean().optional(),
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
export type QueueSummary = Partial<AdmissionStatus> & {
  reminderDue?: boolean
  reminderId?: string | null
  manualJoinWhatsappRequired?: boolean
  id: string
  name: string
  venueId: string
  capacity: number
  averageMinutes: number
  open: number
  version: number
  config: ServiceInput
  inventoryConfirmed?: boolean
  outsideSchedule?: boolean
  readiness?: QueueReadiness
}
export type StaffEntry = {
  displayName?: string | null
  receptionService?: 'check_in' | 'check_out' | 'other' | null
  preferredSpaceId?: string | null
  space?: {
    id: string
    name: string
    source: 'preferred' | 'predicted' | 'assigned'
  } | null
  id: string
  code: string
  partySize: number
  status: string
  sequence: number
  version: number
  calledAt: number | null
  position?: number
  etaMinutes?: number
  predictedAt?: number | null
  estimateQuality?: 'estimated' | 'provisional' | 'unknown'
  resourceId?: string | null
  callable?: boolean
}

const occupancyAnswerSchema = z.object({
  spaceId: z.string().min(1).max(100),
  seats: z.number().int().min(1).max(100),
  occupied: z.number().int().min(0).max(1000),
})
export const queueLifecycleSchema = z
  .discriminatedUnion('action', [
    z.object({
      action: z.literal('declare_full'),
      contextToken: z.string().min(1).max(200),
    }),
    z.object({
      action: z.literal('pause'),
      contextToken: z.string().min(1).max(200),
    }),
    z.object({
      action: z.literal('resume'),
      contextToken: z.string().min(1).max(200),
    }),
    z.object({
      action: z.literal('dismiss_reminder'),
      contextToken: z.string().min(1).max(200),
    }),
    z.object({
      action: z.literal('release_unit'),
      contextToken: z.string().min(1).max(200),
      spaceId: z.string().min(1).max(100),
      seats: z.number().int().min(1).max(100),
    }),
    z.object({
      action: z.literal('open'),
      contextToken: z.string().min(1).max(200),
      groups: z.array(occupancyAnswerSchema).max(600),
    }),
    z.object({
      action: z.literal('confirm_inventory'),
      contextToken: z.string().min(1).max(200),
      groups: z.array(occupancyAnswerSchema).max(600),
    }),
    z.object({
      action: z.literal('disable_intelligence'),
      contextToken: z.string().min(1).max(200),
    }),
    z.object({
      action: z.literal('enable_intelligence'),
      contextToken: z.string().min(1).max(200),
    }),
    z.object({
      action: z.literal('close'),
      contextToken: z.string().min(1).max(200),
    }),
    z.object({
      action: z.literal('occupancy'),
      contextToken: z.string().min(1).max(200),
      group: occupancyAnswerSchema,
      reason: z.string().trim().min(3).max(300),
    }),
  ])
  .superRefine((input, ctx) => {
    if (
      (input.action === 'open' || input.action === 'confirm_inventory') &&
      new Set(input.groups.map((g) => JSON.stringify([g.spaceId, g.seats])))
        .size !== input.groups.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'Duplicate group answer',
      })
  })
export type QueueLifecycleCommand = z.infer<typeof queueLifecycleSchema>
export type QueueReadiness = {
  state: 'active' | 'pending' | 'disabled'
  reasons: (
    | 'configuration_missing'
    | 'inventory_required'
    | 'inventory_refresh_required'
    | 'legacy_occupancy'
  )[]
}
export type QueueOpeningContext = Partial<AdmissionStatus> & {
  windowId?: string | null
  activatedAt?: number | null
  reminderDue?: boolean
  reminderId?: string | null
  open: boolean
  version: number
  contextToken: string
  pendingCount: number
  untrackedCount: number
  inventoryConfirmed?: boolean
  readiness: QueueReadiness
  groups: {
    spaceId: string
    spaceName: string
    seats: number
    count: number
    allocated: number
    occupied: number
  }[]
}
