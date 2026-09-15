import { z } from 'zod'

export const consentVersion = 'whatsapp-queue-updates-v1'
export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/)
export const joinQueueSchema = z.strictObject({
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
export const entrySchema = z.object({
  code: z.string(),
  position: z.number().int().nonnegative(),
  etaMinutes: z.number().int().nonnegative(),
  status: z.enum(['waiting', 'served', 'cancelled']),
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
  en: 'I agree to receive updates for this queue entry on WhatsApp. I can opt out by sending STOP or BAJA. Provisional testing notice.',
}
