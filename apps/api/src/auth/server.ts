import { betterAuth } from 'better-auth'
import { admin, username, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { ac, roles } from './permissions'
import { sendMail } from './mail'
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
const authInstances = new WeakMap<
  D1Database,
  { configuration: AuthConfiguration; auth: ReturnType<typeof initializeAuth> }
>()
export function createAuth(env: CloudflareBindings) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error('auth_not_configured')
  const existing = authInstances.get(env.DB)
  if (
    existing &&
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
  authInstances.set(env.DB, { configuration: snapshot, auth })
  return auth
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
