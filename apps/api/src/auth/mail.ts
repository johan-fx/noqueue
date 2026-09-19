type LocalMail = {
  subject: string
  text: string
  createdAt: number
}

// Deliberately memory-only: it exists solely in `wrangler dev`, is never logged
// and disappears on a worker restart. This lets local users exercise verified
// email changes without putting a real provider key in .dev.vars.
const localInbox = new Map<string, LocalMail>()

export function readLocalMail(email: string) {
  return localInbox.get(email.toLowerCase())
}

// No tokens, email bodies or recipient addresses are written to logs.
export async function sendMail(
  env: CloudflareBindings,
  to: string,
  subject: string,
  text: string,
) {
  if (env.APP_ENV === 'local' && env.AUTH_EMAIL_API_KEY === 'local-inbox') {
    localInbox.set(to.toLowerCase(), { subject, text, createdAt: Date.now() })
    return
  }
  if (!env.AUTH_EMAIL_API_KEY || !env.AUTH_EMAIL_FROM)
    throw new Error('auth_email_not_configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.AUTH_EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('auth_email_delivery_failed')
}
