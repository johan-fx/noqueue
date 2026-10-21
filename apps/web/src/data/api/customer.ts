import { detectRuntime } from '@/app/bootstrap/runtime'
import { installationSecret } from '@/platform/capacitor/installation'

/** Never forward an installation credential to a caller-controlled URL. */
export function nativeApiUrl(path: string, base: string | undefined): string {
  if (!(path === '/api/v1/public/search' || /^\/api\/v1\/public\/(?:services|venues|entries)(?:\/|$)/.test(path)) || /[?#\\]/.test(path) || /%|\.\./.test(path))
    throw new Error('Unsupported mobile API route')
  const origin = new URL(base ?? '')
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('Configure an HTTPS VITE_API_URL origin for mobile')
  return `${origin.origin}${path.replace('/api/v1/public/', '/api/v1/mobile/')}`
}
export async function customerFetch(path: string, init?: RequestInit) {
  if (detectRuntime() !== 'native') return fetch(path, init)
  const url = nativeApiUrl(path, import.meta.env.VITE_API_URL)
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${await installationSecret()}`)
  return fetch(url, { ...init, headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
}

/** Push endpoints use the same installation credential, never a token as authentication. */
export async function nativePushFetch(path: string, init?: RequestInit) {
  if (detectRuntime() !== 'native' || !/^\/(?:registration|revoke|notices\/[a-f0-9]{32})$/.test(path)) throw new Error('Unsupported push route')
  const base = nativeApiUrl('/api/v1/public/entries', import.meta.env.VITE_API_URL)
  const url = base.replace(/\/entries$/, '/push') + path
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${await installationSecret()}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
  } finally { clearTimeout(timer) }
}
