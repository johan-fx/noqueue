const identifier = /^[A-Za-z0-9_-]{1,128}$/
const recoveryToken = /^[a-f0-9]{64}$/
const notificationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function customerRouteFromUrl(
  rawUrl: string,
  configuredOrigin: string | undefined,
): string | null {
  if (!configuredOrigin) return null

  try {
    const url = new URL(rawUrl)
    const origin = new URL(configuredOrigin)
    if (
      url.protocol !== 'https:' ||
      origin.protocol !== 'https:' ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.hash
    )
      return null

    for (const key of new Set(url.searchParams.keys()))
      if (
        !['lang', 'source', 'notice'].includes(key) ||
        url.searchParams.getAll(key).length !== 1
      )
        return null

    const lang = url.searchParams.get('lang')
    const source = url.searchParams.get('source')
    const notice = url.searchParams.get('notice')
    if (
      (lang && lang !== 'es' && lang !== 'en') ||
      (source && source !== 'whatsapp') ||
      (notice && (!notificationId.test(notice) || source !== 'whatsapp'))
    )
      return null

    const parts = url.pathname.split('/')
    if (parts.length !== 3 || parts[0] !== '') return null
    const [kind, value] = parts.slice(1)
    if (
      (kind === 't' && !recoveryToken.test(value ?? '')) ||
      ((kind === 'v' || kind === 'q') && !identifier.test(value ?? '')) ||
      !['t', 'v', 'q'].includes(kind ?? '') ||
      (notice && kind !== 't')
    )
      return null

    const query = new URLSearchParams()
    if (lang) query.set('lang', lang)
    if (source) query.set('source', source)
    if (notice) query.set('notice', notice)
    const search = query.toString()
    return `${url.pathname}${search ? `?${search}` : ''}`
  } catch {
    return null
  }
}
