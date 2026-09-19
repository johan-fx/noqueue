import { betterAuth } from 'better-auth'
import { admin, username, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { ac, roles } from './permissions'
import { sendMail } from './mail'
const platformAC = createAccessControl({
  user: ['create'],
  session: ['revoke'],
} as const)
export function createAuth(env: CloudflareBindings) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error('auth_not_configured')
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
