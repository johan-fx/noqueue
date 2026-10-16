import { crossesPrivacyBoundary, type PrivacyHandle } from '@noqueue/privacy'
const JOINED_KEY = 'noqueue.just-joined'
type Destination = { pathname: string; search: string; hash: string; state?: unknown }
export function guardPrivacyNavigation(
  from: { pathname: string }, to: Destination, action: string, privacy: Pick<PrivacyHandle, 'suspend'>,
  navigate: (url: string, replace: boolean) => void = (url, replace) => replace ? location.replace(url) : location.assign(url),
): boolean {
  if (!crossesPrivacyBoundary(from.pathname, to.pathname)) return false
  privacy.suspend()
  if (to.pathname.startsWith('/t/') && typeof to.state === 'object' && to.state !== null && 'joined' in to.state && to.state.joined === true) {
    try { sessionStorage.setItem(JOINED_KEY, String(Date.now())) } catch { /* UI notice only; ticket is already durable. */ }
  }
  navigate(to.pathname + to.search + to.hash, action !== 'PUSH')
  return true
}
export function restoreJoinedNotice() {
  try {
    const raw = sessionStorage.getItem(JOINED_KEY)
    sessionStorage.removeItem(JOINED_KEY)
    const time = Number(raw)
    if (raw && /^\/t\/[a-f0-9]{64}$/.test(location.pathname) && time <= Date.now() && Date.now() - time < 60000) {
      history.replaceState({ ...history.state, usr: { ...history.state?.usr, joined: true } }, '')
    }
  } catch { /* No persistent credentials are needed for this optional UI notice. */ }
}
