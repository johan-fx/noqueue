import { betterAuth } from 'better-auth'
import { admin, username, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { ac, roles } from './permissions'
import { sendMail } from './mail'
import { readDeadline, ReadDeadlineError } from '../lib/deadline'
const platformAC = createAccessControl({
  user: ['create'],
  session: ['revoke'],
} as const)
const authConfigurationKeys = [
  'BETTER_AUTH_SECRET',
  'PUBLIC_APP_ORIGIN',
  'APP_ENV',
  'AUTH_EMAIL_API_KEY',
  'AUTH_EMAIL_FROM',
] as const
type AuthConfiguration = Pick<
  CloudflareBindings,
  (typeof authConfigurationKeys)[number]
>
// Binding-only deployments can reuse an isolate. Keep one latest context per
// weak DB owner, and compare every auth/mail input rather than env identity.
type AuthInstance = {
  configuration: AuthConfiguration
  auth: ReturnType<typeof initializeAuth>
  startedAt: number
  initialized: boolean
  ready?: Promise<void>
}
const authInstances = new WeakMap<D1Database, AuthInstance>()
export function createAuth(env: CloudflareBindings) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error('auth_not_configured')
  const existing = authInstances.get(env.DB)
  if (
    existing &&
    (existing.initialized || Date.now() - existing.startedAt < 10_000) &&
    authConfigurationKeys.every(
      (key) => existing.configuration[key] === env[key],
    )
  )
    return existing.auth
  // Snapshot closures too: an in-flight request must keep the configuration
  // that initialized its auth instance even if its caller mutates env later.
  const snapshot = { ...env }
  const auth = initializeAuth(snapshot)
  // betterAuth owns the shared initialization/schema-check promise, not us.
  // Session and permission results are deliberately never stored here.
  authInstances.set(env.DB, { configuration: snapshot, auth, startedAt: Date.now(), initialized: false })
  return auth
}

// Protect only initialization, never a staff mutation, after client disconnect.
// A failed/stalled initialization is evicted; the next request may initialize
// again, but this request is not retried. Authorization/session data stays live.
export async function readyAuth(
  env: CloudflareBindings,
  context?: { waitUntil(promise: Promise<unknown>): void },
) {
  const auth = createAuth(env)
  const entry = authInstances.get(env.DB)!
  if (!entry.ready) {
    entry.ready = readDeadline(auth.$context.then(async (ctx) => {
      await ctx.checkSchema?.()
    }), 8_000).then(() => {
      entry.initialized = true
    }).catch((error) => {
      if (authInstances.get(env.DB) === entry) authInstances.delete(env.DB)
      throw error
    })
  }
  context?.waitUntil(entry.ready.catch(() => undefined))
  await entry.ready
  return auth
}

function evictAuth(env: CloudflareBindings, auth: ReturnType<typeof initializeAuth>) {
  if (authInstances.get(env.DB)?.auth === auth) authInstances.delete(env.DB)
}

export async function readAuthSession(
  env: CloudflareBindings,
  headers: Headers,
  context?: { waitUntil(promise: Promise<unknown>): void },
  onReady?: () => void,
) {
  const started = Date.now()
  const auth = await readyAuth(env, context)
  onReady?.()
  // The cached Kysely SQLite adapter also owns a connection mutex. Protect warm
  // reads, not just cold initialization: canceling their request must not strand
  // a borrowed connection and block every subsequent session read in this isolate.
  const operation = readDeadline(auth.api.getSession({ headers }), Math.max(1, 10_000 - (Date.now() - started)))
    .catch((error) => {
      if (error instanceof ReadDeadlineError) {
        evictAuth(env, auth)
        if (env.APP_ENV === 'staging') console.warn({ event: 'auth_session_timeout', evicted: true })
      }
      throw error
    })
  context?.waitUntil(operation.catch(() => undefined))
  return operation
}

export async function authResponse(
  env: CloudflareBindings,
  request: Request,
  context?: { waitUntil(promise: Promise<unknown>): void },
) {
  const auth = await readyAuth(env, context)
  const operation = auth.handler(request)
  // Auth HTTP endpoints share the same adapter. Preserve its release/finally
  // after disconnect too; never retry an auth write or replace its result.
  context?.waitUntil(readDeadline(operation, 25_000).catch((error) => {
    if (error instanceof ReadDeadlineError) evictAuth(env, auth)
  }))
  return operation
}
function initializeAuth(env: CloudflareBindings) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_APP_ORIGIN,
    basePath: '/api/v1/auth',
    trustedOrigins: [env.PUBLIC_APP_ORIGIN],
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 15,
      maxPasswordLength: 128,
    },
    user: {
      changeEmail: { enabled: true, updateEmailWithoutVerification: false },
    },
    emailVerification: {
      expiresIn: 1800,
      sendOnSignUp: false,
      sendOnSignIn: false,
      async sendVerificationEmail({ user, url }) {
        if (user.email.endsWith('.invalid'))
          throw new Error('real_email_required')
        try {
          await sendMail(
            env,
            user.email,
            'NoQueue · Verifica tu email',
            `Confirma tu dirección de email: ${url}`,
          )
        } catch {
          // Better Auth intentionally absorbs verification-delivery errors; preserve a safe operational signal.
          console.warn('auth_email_delivery_failed')
          throw new Error('auth_email_delivery_failed')
        }
      },
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 30,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    advanced: {
      useSecureCookies: env.APP_ENV !== 'local',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    plugins: [
      admin({
        ac: platformAC,
        roles: {
          user: platformAC.newRole({}),
          commercial_operator: platformAC.newRole({}),
          platform_admin: platformAC.newRole({
            user: ['create'],
            session: ['revoke'],
          }),
        },
      }),
      organization({
        ac,
        roles,
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        requireEmailVerificationOnInvitation: true,
      }),
      username({ immutableUsername: true }),
    ],
  })
}
