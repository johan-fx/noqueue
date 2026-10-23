import { z } from 'zod'

export const consentVersion = 'whatsapp-queue-updates-v1'
export const publicServiceConsentVersion = 'whatsapp-public-service-updates-v1'
export const manualConsentVersion = 'whatsapp-manual-queue-updates-v2'
export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/)
export const receptionServiceSchema = z.enum(['check_in', 'check_out', 'other'])
export const serviceJoinSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100).optional(),
  receptionService: receptionServiceSchema.optional(),
  preferredSpaceId: z.string().trim().min(1).max(100).optional(),
  partySize: z.number().int().min(1).max(20),
  locale: z.enum(['es', 'en']),
})
export type ServiceJoin = z.infer<typeof serviceJoinSchema>
export const publicServiceJoinSchema = serviceJoinSchema.extend({
  displayName: z.string().trim().min(1).max(100),
  whatsapp: z.strictObject({
    consent: z.literal(true),
    phone: phoneSchema,
    version: z.literal(publicServiceConsentVersion),
  }),
})
export type PublicServiceJoin = z.infer<typeof publicServiceJoinSchema>
/** Native admission deliberately has no contact or notification-consent fields. */
export const mobileServiceJoinSchema = serviceJoinSchema.extend({
  displayName: z.string().trim().min(1).max(100),
})
export type MobileServiceJoin = z.infer<typeof mobileServiceJoinSchema>

export const admissionFields = {
  serviceOpen: z.boolean().optional(),
  queueState: z.enum(['inactive', 'active', 'paused']).optional(),
  canJoin: z.boolean().optional(),
  blockReason: z
    .enum(['closed', 'inactive', 'paused', 'cutoff', 'capacity'])
    .nullable()
    .optional(),
  waitingPeople: z.number().nonnegative().optional(),
  // Real queue entries, not the sum of group members. Optional for older servers.
  waitingTurns: z.number().int().nonnegative().optional(),
  initialWaitingMarker: z.boolean().optional(),
}
export type AdmissionStatus = {
  serviceOpen: boolean
  queueState: 'inactive' | 'active' | 'paused'
  canJoin: boolean
  blockReason: 'closed' | 'inactive' | 'paused' | 'cutoff' | 'capacity' | null
  waitingPeople: number
  waitingTurns: number
  initialWaitingMarker: boolean
}
/** Present a wait in whole minutes; keep forecast/deadline calculations precise. */
export function roundWaitMinutes(minutes: number): number {
  return Math.round(minutes)
}
/** Public discovery lists only physically open services with an active list. */
export function isActivePublicList(service: {
  serviceOpen?: boolean | undefined
  queueState?: AdmissionStatus['queueState'] | undefined
}): boolean {
  return service.serviceOpen === true && service.queueState === 'active'
}
export const publicServiceSchema = z.object({
  ...admissionFields,
  // Additive projection: absent on older API versions. Venue-local time is
  // formatted on the server; the countdown uses server time, not device time.
  nextOpening: z.object({
    at: z.number().int().nonnegative(),
    serverNow: z.number().int().nonnegative(),
    localTime: z.string().regex(/^\d{2}:\d{2}$/),
  }).nullable().optional(),
  id: z.string(),
  name: z.string(),
  venueName: z.string(),
  // Optional for older clients/fixtures; the API always returns URL or null.
  venueLogoUrl: z.string().nullable().optional(),
  venueId: z.string().optional(),
  open: z.number(),
  averageWaitMinutes: z.number().nullable().optional(),
  averageWaitQuality: z.enum(['estimated', 'provisional', 'unknown']).optional(),
  type: z.enum(['restaurant', 'reception', 'pool']),
  receptionServices: z.array(receptionServiceSchema),
  spaces: z.array(
    z.object({ id: z.string(), name: z.string(), maxPartySize: z.number() }),
  ),
})
export type PublicService = z.infer<typeof publicServiceSchema>
/** Only venue selection includes scheduled-closed service cards. */
export function isVisibleVenueService(service: PublicService): boolean {
  return isActivePublicList(service) || (service.serviceOpen === false && service.nextOpening != null)
}
export const joinQueueSchema = serviceJoinSchema.extend({
  partySize: z.number().int().min(1).max(20),
  locale: z.enum(['es', 'en']),
  whatsapp: z.discriminatedUnion('consent', [
    z.strictObject({ consent: z.literal(false) }),
    z.strictObject({
      consent: z.literal(true),
      phone: phoneSchema,
      version: z.enum([consentVersion, publicServiceConsentVersion]),
    }),
  ]),
})
export const manualJoinSchema = joinQueueSchema.extend({
  displayName: z.string().trim().min(1).max(100),
  whatsapp: z
    .discriminatedUnion('consent', [
      z.strictObject({ consent: z.literal(false) }),
      z.strictObject({
        consent: z.literal(true),
        phone: phoneSchema,
        version: z.enum([
          consentVersion,
          publicServiceConsentVersion,
          manualConsentVersion,
        ]),
      }),
    ])
    .default({ consent: false }),
})
export type ManualJoin = z.infer<typeof manualJoinSchema>
export const confirmationJoinSchema = z.strictObject({
  partySize: z.number().int().min(1).max(20),
  locale: z.enum(['es', 'en']),
  phone: phoneSchema,
  priorContactAuthorization: z.literal(true),
})
export type JoinQueue = z.infer<typeof joinQueueSchema>
export const notificationStatusSchema = z.enum([
  'disabled',
  'pending',
  'sending',
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'unknown',
  'cancelled',
])
export const customerCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('update'),
    version: z.number().int().nonnegative(),
    displayName: z.string().trim().min(1).max(100),
    partySize: z.number().int().min(1).max(20),
    preferredSpaceId: z.string().min(1).max(100),
    locale: z.enum(['es', 'en']),
  }),
  z.strictObject({
    action: z.literal('cancel'),
    version: z.number().int().nonnegative(),
  }),
  z.strictObject({
    action: z.literal('yield'),
    version: z.number().int().nonnegative(),
  }),
])
export type CustomerCommand = z.infer<typeof customerCommandSchema>
export const publicVenueSchema = z.object({
  id: z.string(),
  name: z.string(),
  services: z.array(
    publicServiceSchema.extend({
      waitingPeople: z.number(),
      averageWaitMinutes: z.number().nullable(),
    }),
  ),
})
export type PublicVenue = z.infer<typeof publicVenueSchema>
export const entrySchema = z.object({
  initialEtaMinutes: z.number().int().positive().nullable().optional(),
  // Version 1 is the legacy estimator; absent values retain legacy behavior.
  estimatorVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  estimationRevision: z.number().int().nonnegative().optional(),
  safetyReviewAt: z.number().nullable().optional(),
  delay: z
    .object({
      reason: z.enum(['safety', 'resources', 'cadence', 'configuration']),
      since: z.number(),
      previousPredictedAt: z.number(),
    })
    .nullable()
    .optional(),
  customer: z
    .object({
      service: publicServiceSchema,
      displayName: z.string().nullable(),
      partySize: z.number(),
      preferredSpaceId: z.string().nullable(),
      locale: z.enum(['es', 'en']),
      version: z.number().int(),
      serverNow: z.number(),
      createdAt: z.number(),
      calledAt: z.number().nullable(),
      arrivalDeadlineAt: z.number().nullable(),
      arrivedAt: z.number().nullable(),
      cancellationReason: z.literal('service_ended').optional(),
      manualOnly: z.boolean().optional(),
      phase: z.enum([
        'waiting',
        'approaching',
        'called',
        'arrived',
        'expired',
        'cancelled',
      ]),
      actions: z.array(z.enum(['update', 'cancel', 'yield'])),
    })
    .optional(),
  code: z.string(),
  position: z.number().int().nonnegative(),
  etaMinutes: z.number().int().nonnegative(),
  predictedAt: z.number().nullable().optional(),
  estimateQuality: z.enum(['estimated', 'provisional', 'unknown']).optional(),
  status: z.enum([
    'waiting',
    'called',
    'completed',
    'no_show',
    'expired',
    'served',
    'cancelled',
  ]),
  notification: notificationStatusSchema,
  confirmation: z
    .enum(['pending', 'confirmed', 'revoked', 'expired'])
    .optional(),
})
export const joinedEntrySchema = entrySchema.extend({
  recoveryToken: z.string().regex(/^[a-f0-9]{64}$/),
})
export type Entry = z.infer<typeof entrySchema>
export const consentCopy = {
  es: 'Acepto recibir actualizaciones de este turno por WhatsApp. Puedo darme de baja enviando STOP o BAJA. Aviso provisional para pruebas.',
  en: 'I agree to receive updates for this waiting list entry on WhatsApp. I can opt out by sending STOP or BAJA. Provisional testing notice.',
}

/** Presentation only: never use this virtual floor for ordering or estimates. */
export function visibleWaitingCount(real: number): number {
  return Math.max(1, real)
}

/** Capability returned only over the installation-authenticated mobile transport. */
export const mobileActiveEntrySchema = z.object({
  serviceId: z.string(),
  locale: z.enum(['es', 'en']),
  recoveryToken: z.string().regex(/^[a-f0-9]{64}$/),
})
export const mobileActiveConflictSchema = z.object({
  error: z.literal('active_turn_exists'),
  entry: mobileActiveEntrySchema,
})
