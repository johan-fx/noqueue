import { z } from 'zod'

const fcmToken = z.string().min(20).max(1024).regex(/^[A-Za-z0-9_:\-]+$/)

export const pushRegistrationSchema = z.discriminatedUnion('platform', [
  z.strictObject({ platform: z.literal('ios'), provider: z.literal('fcm'), token: fcmToken, locale: z.enum(['es', 'en']) }),
  z.strictObject({ platform: z.literal('android'), provider: z.literal('fcm').optional(), token: fcmToken, locale: z.enum(['es', 'en']) }),
])
// A routing hint, NOT an entry capability or authentication credential.
export const pushNoticeDataSchema = z.object({ type: z.literal('queue-update'), notificationId: z.string().regex(/^[a-f0-9]{32}$/) })
export const pushResolutionSchema = z.object({ recoveryToken: z.string().regex(/^[a-f0-9]{64}$/), locale: z.enum(['es', 'en']) })

export const pushStatusSchema = z.object({ available: z.boolean(), enabled: z.boolean(), providers: z.object({ ios: z.boolean(), android: z.boolean() }) })
