import { z } from 'zod'

export const consentVersion = 'whatsapp-queue-updates-v1'
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
export const admissionFields = {
  serviceOpen: z.boolean().optional(),
  queueState: z.enum(['inactive', 'active', 'paused']).optional(),
  canJoin: z.boolean().optional(),
  blockReason: z
    .enum(['closed', 'inactive', 'paused', 'cutoff', 'capacity'])
    .nullable()
    .optional(),
  waitingPeople: z.number().nonnegative().optional(),
  initialWaitingMarker: z.boolean().optional(),
}
export type AdmissionStatus = {
  serviceOpen: boolean
  queueState: 'inactive' | 'active' | 'paused'
  canJoin: boolean
  blockReason: 'closed' | 'inactive' | 'paused' | 'cutoff' | 'capacity' | null
  waitingPeople: number
  initialWaitingMarker: boolean
}
export const publicServiceSchema = z.object({
  ...admissionFields,
  id: z.string(),
  name: z.string(),
  venueName: z.string(),
  venueId: z.string().optional(),
  open: z.number(),
  averageWaitMinutes: z.number().nullable().optional(),
  type: z.enum(['restaurant', 'reception', 'pool']),
  receptionServices: z.array(receptionServiceSchema),
  spaces: z.array(
    z.object({ id: z.string(), name: z.string(), maxPartySize: z.number() }),
  ),
})
export type PublicService = z.infer<typeof publicServiceSchema>
export const joinQueueSchema = serviceJoinSchema.extend({
  partySize: z.number().int().min(1).max(20),
  locale: z.enum(['es', 'en']),
  whatsapp: z.discriminatedUnion('consent', [
    z.strictObject({ consent: z.literal(false) }),
    z.strictObject({
      consent: z.literal(true),
      phone: phoneSchema,
      version: z.literal(consentVersion),
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
        version: z.enum([consentVersion, manualConsentVersion]),
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
