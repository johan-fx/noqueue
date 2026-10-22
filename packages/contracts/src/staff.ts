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
  'metrics.read',
] as const
export type Capability = (typeof capabilities)[number]
export const roleCapabilities: Record<StaffRole, readonly Capability[]> = {
  owner: capabilities,
  venue_manager: ['queue.read', 'queue.operate', 'queue.configure', 'metrics.read'],
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
export const timeRangeSchema = z
  .object({
    from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .refine((value) => value.from < value.to, {
    message: 'Use separate ranges for overnight hours',
    path: ['to'],
  })
export const scheduleGroupSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    twentyFourHours: z.boolean(),
    ranges: z.array(timeRangeSchema).max(28),
  })
  .superRefine((group, ctx) => {
    if (new Set(group.days).size !== group.days.length)
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Duplicate days',
      })
    if (group.twentyFourHours ? group.ranges.length > 0 : !group.ranges.length)
      ctx.addIssue({
        code: 'custom',
        path: ['ranges'],
        message: 'Add opening hours',
      })
    for (let i = 0; i < group.ranges.length; i++)
      for (let j = 0; j < i; j++) {
        const a = group.ranges[i]!,
          b = group.ranges[j]!
        if (a.from < b.to && b.from < a.to)
          ctx.addIssue({
            code: 'custom',
            path: ['ranges', i],
            message: 'Overlapping hours',
          })
      }
  })
export type ScheduleGroup = z.infer<typeof scheduleGroupSchema>
export type WeeklySchedule = {
  schedules: z.infer<typeof scheduleSchema>[]
  allDayDays: number[]
}
type CalendarInput = {
  scheduleGroups?: ScheduleGroup[] | undefined
  schedules?: z.infer<typeof scheduleSchema>[] | undefined
  twentyFourHours?: boolean | undefined
}

/** Lossless legacy conversion: group only days with identical complete patterns. */
export function readScheduleGroups(config: CalendarInput): ScheduleGroup[] {
  if (config.scheduleGroups)
    return config.scheduleGroups.map((group) => ({
      ...group,
      days: [...group.days],
      ranges: group.ranges.map((range) => ({ ...range })),
    }))
  if (config.twentyFourHours)
    return [{ days: [1, 2, 3, 4, 5, 6, 0], twentyFourHours: true, ranges: [] }]
  const groups = new Map<string, ScheduleGroup>()
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const ranges = (config.schedules ?? [])
      .filter((slot) => slot.day === day)
      .map(({ from, to }) => ({ from, to }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    if (!ranges.length) continue
    const key = JSON.stringify(ranges),
      prior = groups.get(key)
    if (prior) prior.days.push(day)
    else groups.set(key, { days: [day], twentyFourHours: false, ranges })
  }
  return [...groups.values()]
}

/** Runtime consumers share a canonical calendar, independent of UI card ordering. */
export function weeklySchedule(config: CalendarInput): WeeklySchedule {
  const groups = readScheduleGroups(config)
  return {
    allDayDays: groups
      .filter((group) => group.twentyFourHours)
      .flatMap((group) => group.days)
      .sort((a, b) => a - b),
    schedules: groups
      .filter((group) => !group.twentyFourHours)
      .flatMap((group) =>
        group.days.flatMap((day) =>
          group.ranges.map((range) => ({ day, ...range })),
        ),
      )
      .sort(
        (a, b) =>
          a.day - b.day ||
          a.from.localeCompare(b.from) ||
          a.to.localeCompare(b.to),
      ),
  }
}

export function pruneScheduleReminders<
  T extends CalendarInput & {
    reminder?:
      | {
          enabled: boolean
          dailyAt?: string | undefined
          intervals: { day: number; from: string; to: string; at: string }[]
        }
      | undefined
  },
>(config: T): T {
  if (!config.reminder) return config
  const calendar = weeklySchedule(config)
  const { dailyAt, ...reminder } = config.reminder
  return {
    ...config,
    reminder: {
      ...reminder,
      ...(calendar.allDayDays.length && dailyAt ? { dailyAt } : {}),
      intervals: reminder.intervals.filter((item) =>
        calendar.schedules.some(
          (slot) =>
            slot.day === item.day &&
            slot.from === item.from &&
            slot.to === item.to,
        ),
      ),
    },
  }
}
const serviceBaseSchema = z.object({
  name,
  type: z.enum(['restaurant', 'reception', 'pool']),
  // V2 is the intelligent default; explicit v1 remains available for rollback.
  estimatorVersion: z.union([z.literal(1), z.literal(2)]).default(2),
  capacity: z.number().int().min(1).max(10000),
  averageMinutes: z.number().int().min(1).max(1440),
  approachTurns: z.number().int().min(0).max(100).optional(),
  approachMinutes: z.number().int().min(0).max(1440).optional(),
  etaChangeThresholdMinutes: z.number().int().min(1).max(60).optional(),
  notificationCooldownMinutes: z.number().int().min(1).max(120).optional(),
  graceMinutes: z.number().int().min(1).max(120),
  cutoffMinutes: z.number().int().min(0).max(240),
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
  receptionServices: z.array(z.enum(['check_in', 'check_out', 'other'])).max(3),
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
export const serviceSchema = z
  .union([
    serviceBaseSchema.extend({
      twentyFourHours: z.boolean(),
      schedules: z.array(scheduleSchema).max(28),
      scheduleGroups: z.never().optional(),
    }),
    serviceBaseSchema.extend({
      scheduleGroups: z.array(scheduleGroupSchema).min(1).max(7),
      twentyFourHours: z.never().optional(),
      schedules: z.never().optional(),
    }),
  ])
  .superRefine((v, ctx) => {
    const grouped = v.scheduleGroups !== undefined
    if (
      grouped
        ? v.twentyFourHours !== undefined || v.schedules !== undefined
        : v.twentyFourHours === undefined || v.schedules === undefined
    )
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleGroups'],
        message: 'Use exactly one schedule format',
      })
    const calendar = weeklySchedule(v)
    const schedules = grouped ? calendar.schedules : v.schedules ?? []
    if (grouped) {
      const days = v.scheduleGroups!.flatMap((group) => group.days)
      if (new Set(days).size !== days.length)
        ctx.addIssue({
          code: 'custom',
          path: ['scheduleGroups'],
          message: 'Days belong to only one schedule',
        })
      if (calendar.schedules.length > 28)
        ctx.addIssue({
          code: 'custom',
          path: ['scheduleGroups'],
          message: 'Maximum 28 opening intervals',
        })
    }
    if (!grouped && !v.twentyFourHours && !v.schedules?.length)
      ctx.addIssue({
        code: 'custom',
        path: ['schedules'],
        message: 'Add opening hours',
      })
    if (v.reminder?.enabled) {
      const time = (value: string) =>
        Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
      if (
        v.type !== 'restaurant' ||
        (calendar.allDayDays.length > 0 && !v.reminder.dailyAt)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['reminder'],
          message: 'Restaurant reminder requires a valid time',
        })
      const keys = new Set<string>()
      for (const reminder of v.reminder.intervals) {
        const interval = schedules.find(
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
    for (let i = 0; i < schedules.length; i++)
      for (let j = 0; j < i; j++) {
        const a = schedules[i]!,
          b = schedules[j]!
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
// Keep input callers source-compatible with older saved/request records that
// omit estimatorVersion; parsing supplies the intelligent v2 default.
export type ServiceInput = z.input<typeof serviceSchema>
/** New clients write groups only; legacy records are converted without rewriting storage on read. */
export type GroupedServiceInput = Extract<
  ServiceInput,
  { scheduleGroups: ScheduleGroup[] }
>
export function toGroupedService(input: ServiceInput): GroupedServiceInput {
  const { twentyFourHours, schedules, ...common } = input
  return {
    ...common,
    scheduleGroups: readScheduleGroups({
      twentyFourHours,
      schedules,
      scheduleGroups: input.scheduleGroups,
    }),
  }
}

/** Only missing legacy values receive defaults; explicit configured values are retained. */
export const storedServiceSchema = z.preprocess((input) => {
  if (input && typeof input === 'object') {
    const value = input as { type?: string }
    const record = input as Record<string, unknown>
    return {
      ...record,
      ...(!('graceMinutes' in record)
        ? { graceMinutes: value.type === 'restaurant' ? 5 : 2 }
        : {}),
      ...(!('etaChangeThresholdMinutes' in record)
        ? { etaChangeThresholdMinutes: 5 }
        : {}),
      ...(!('notificationCooldownMinutes' in record)
        ? { notificationCooldownMinutes: 10 }
        : {}),
    }
  }
  return input
}, serviceSchema)

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
export type ProvisionInput = z.input<typeof provisionSchema>
const memberFields = z.object({
  name,
  username: usernameSchema,
  role: z.enum(['venue_manager', 'queue_staff', 'viewer']),
  queueIds: z.array(z.string().min(1).max(100)).default([]),
})
export function validQueueAssignment(input: {
  role: string
  queueIds: string[]
}) {
  return input.role === 'queue_staff'
    ? input.queueIds.length > 0 &&
        new Set(input.queueIds).size === input.queueIds.length
    : input.queueIds.length === 0
}
function validateMemberAssignments(
  input: { role: string; queueIds: string[] },
  ctx: z.RefinementCtx,
) {
  if (!validQueueAssignment(input))
    ctx.addIssue({
      code: 'custom',
      path: ['queueIds'],
      message:
        input.role !== 'queue_staff'
          ? 'Solo Personal de lista puede tener servicios asignados'
          : input.queueIds.length === 0
          ? 'Selecciona al menos un servicio'
          : 'No repitas servicios',
    })
}
export const inviteSchema = memberFields
  .extend({ password: passwordSchema })
  .superRefine(validateMemberAssignments)
export const memberDetailsSchema = memberFields.superRefine(
  validateMemberAssignments,
)
export type MemberDetailsInput = z.infer<typeof memberDetailsSchema>
export type StaffMember = {
  id: string
  name: string
  username: string
  role: StaffRole
  active: number
  canEditDetails: boolean
  queueIds: string[]
}
/** Physical context confirmed by staff, never an inventory reservation. */
export const assignmentSeatingSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('confirmed'),
      spaceId: z.string().min(1).max(100),
      seats: z.number().int().min(1).max(100),
    })
    .strict(),
  z.object({ mode: z.literal('unspecified') }).strict(),
])
export type AssignmentSeating = z.infer<typeof assignmentSeatingSchema>

/** Catalogue compatibility only: quantities and occupancy are deliberately ignored. */
export function assignmentTableOptions(
  config: ServiceInput,
  partySize: number,
) {
  if (config.type !== 'restaurant') return []
  return config.spaces.flatMap((space, index) => {
    const seats = (space.tableTypes ?? [])
      .filter((type) => type.seats >= partySize)
      .map((type) => type.seats)
      .sort((a, b) => a - b)
    return seats.length
      ? [{ spaceId: space.id ?? `legacy-${index}`, name: space.name, seats }]
      : []
  })
}
export function defaultAssignmentSeating(
  config: ServiceInput,
  party: { partySize: number; preferredSpaceId?: string | null | undefined },
): AssignmentSeating | null {
  const options = assignmentTableOptions(config, party.partySize)
  if (!options.length) return { mode: 'unspecified' }
  const space =
    options.find((option) => option.spaceId === party.preferredSpaceId) ??
    (options.length === 1 ? options[0] : undefined)
  return space
    ? { mode: 'confirmed', spaceId: space.spaceId, seats: space.seats[0]! }
    : null
}

export const entryCommandSchema = z
  .object({
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
    arrivalMode: z.enum(['notify', 'present']).optional(),
    assignmentToken: z.string().optional(),
    seating: assignmentSeatingSchema.optional(),
  })
  .refine((input) => !input.seating || input.action === 'call', {
    message: 'Seating is only allowed when assigning a turn',
    path: ['seating'],
  })
  .refine((input) => input.action !== 'release', {
    message: 'operation_retired',
    path: ['action'],
  })
export const replacementCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resolve_replacement'), decisionId: z.string().uuid(),
    decisionVersion: z.number().int().nonnegative(), entryId: z.string().uuid(),
    version: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('dismiss_replacement'), decisionId: z.string().uuid(),
    decisionVersion: z.number().int().nonnegative() }).strict(),
])
export type ReplacementCommand = z.infer<typeof replacementCommandSchema>
export type ReplacementDecision = {
  id: string
  version: number
  entryId: string
  originalPartySize: number
  createdAt: number
  reason: 'no_candidate' | 'missing_context' | 'context_changed'
  unavailable: 'disabled' | 'context' | null
  seating: { spaceId: string; spaceName: string; seats: number } | null
  candidates: Array<{ id: string; version: number; code: string; displayName: string | null; partySize: number }>
}
export const queueCommandSchema = z.union([
  replacementCommandSchema,
  // Optional at parsing only: old successful requests can still replay. New
  // commands without both preconditions fail with 409 in the coordinator.
  z.object({
    action: z.literal('assign_next'),
    expectedEntryId: z.string().uuid().optional(),
    expectedVersion: z.number().int().min(0).optional(),
  }).strict(),
  entryCommandSchema,
])
export type QueueCommand = z.infer<typeof queueCommandSchema>
export type EntryCommand = z.infer<typeof entryCommandSchema>
export function defaultGraceMinutes(type: ServiceInput['type']) {
  return type === 'restaurant' ? 5 : 2
}
export function allowedEntryActions(
  type: ServiceInput['type'],
  status: string,
  canOperate = true,
): EntryCommand['action'][] {
  if (!canOperate) return []
  if (status === 'waiting')
    return type === 'restaurant' ? ['call', 'cancel'] : ['cancel']
  if (status === 'called') return ['complete', 'cancel']
  return []
}
export const queueSettingsSchema = z.intersection(
  serviceSchema,
  z.object({
    version: z.number().int().min(0),
    open: z.boolean(),
    applyApproachToActive: z.boolean().optional(),
  }),
)
export const membershipUpdateSchema = z.object({
  role: z.enum(['venue_manager', 'queue_staff', 'viewer']),
  active: z.boolean(),
  // Omitted for an active-only change; resolved against the current membership.
  queueIds: z.array(z.string().min(1).max(100)).optional(),
})
export const VENUE_LOGO_MAX_BYTES = 5 * 1024 * 1024
export const venueLogoSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1).max(180),
  type: z.enum(['image/png', 'image/jpeg']),
  size: z.number().int().positive(),
})
export type VenueLogo = z.infer<typeof venueLogoSchema>
export const venueLogoStateSchema = z.object({
  logo: venueLogoSchema.nullable(),
  logoVersion: z.number().int().nonnegative(),
  canEditLogo: z.boolean(),
})
export type VenueLogoState = z.infer<typeof venueLogoStateSchema>
export const venueLogoMutationSchema = z.object({
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
}).strict()
export type VenueSummary = VenueLogoState & {
  /** Supplied by /staff/me; absent in older/detail-only consumers. */
  timezone?: string
  canReadMetrics?: boolean
  id: string
  name: string
  organizationId: string
  organizationName: string
  role: StaffRole
}
/** Immutable baseline for a configuration draft, prepared by the coordinator. */
export type QueueConfigurationContext = Pick<
  QueueSummary,
  'id' | 'version' | 'open' | 'config'
>

export type QueueSummary = Partial<AdmissionStatus> & {
  autoReplacementEnabled?: boolean
  /** Real waiting turns, independent of the paginated staff entry list. */
  waitingCount?: number
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
  automaticReplacement?: {
    origin: 'staff' | 'yield' | 'arrival_expiry' | 'legacy'
    eligible: boolean
    result: CallReplacementResult
    successor: { id: string; code: string } | null
  } | null
  /** Confirmed context for the current called/completed cycle, not a prediction. */
  assignedSeating?: { spaceId: string; spaceName: string; seats: number } | null
  cancellationReason?: 'service_ended'
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
  arrivalDeadlineAt?: number | null
  allowedActions?: EntryCommand['action'][]
  assignment?: {
    available: boolean
    spaceName: string | null
    priorityRequired: boolean
    token: string
  }
  position?: number
  etaMinutes?: number
  predictedAt?: number | null
  estimateQuality?: 'estimated' | 'provisional' | 'unknown'
  /** Customer-visible wait, independent of operational availability above. */
  waitEstimate?: {
    predictedAt: number | null
    estimateQuality: 'estimated' | 'provisional' | 'unknown'
  }
  resourceId?: string | null
  callable?: boolean
}

export type CallReplacementResult =
  | 'pending' | 'replaced' | 'yielded' | 'arrived' | 'cancelled' | 'no_show'
  | 'returned_to_waiting' | 'no_candidate' | 'missing_context' | 'context_changed'
  | 'service_ended' | 'disabled' | 'legacy'

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
      groups: z.array(occupancyAnswerSchema).max(600).default([]),
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
      ['release_unit', 'occupancy', 'confirm_inventory'].includes(input.action)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['action'],
        message: 'operation_retired',
      })
    if (
      input.action === 'confirm_inventory' &&
      new Set(input.groups.map((g) => JSON.stringify([g.spaceId, g.seats])))
        .size !== input.groups.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'Duplicate group answer',
      })
  })
export type QueueLifecycleCommand = z.input<typeof queueLifecycleSchema>
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

export type CommercialEstablishmentSummary = {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended'
  venueId: string
  venueName: string
  serviceCount: number
  configurationUpdatedAt: number | null
}
export type CommercialEstablishmentPage = {
  items: CommercialEstablishmentSummary[]
  page: number
  hasMore: boolean
}
