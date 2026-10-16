import { privacyOrigins } from '@noqueue/contracts/privacy-policy'
export type Surface = 'landing' | 'app'
export type PrivacyConfig = { surface: Surface; environment: string; enabled: boolean; measurementId: string; native: boolean }
export type SafePage = { path: string; title: string }
const excludedSeeds = new Set(['/v/demo-venue', '/q/demo-queue', '/q/confirmation-experiment'])
export function safePage(surface: Surface, pathname: string): SafePage | null {
  if (excludedSeeds.has(pathname)) return null
  if (pathname === '/') return { path: '/', title: surface === 'landing' ? 'NoQueue' : 'Discover' }
  if (surface === 'landing') return null
  if (pathname === '/search') return { path: '/search', title: 'Search' }
  if (/^\/v\/[A-Za-z0-9-]{1,120}$/.test(pathname)) return { path: '/v/venue', title: 'Venue' }
  if (/^\/q\/[A-Za-z0-9-]{1,120}$/.test(pathname)) return { path: '/q/queue', title: 'Queue' }
  return null
}
export function productionEligible(config: PrivacyConfig, location: Pick<Location, 'origin' | 'protocol'>): boolean {
  return !config.native && config.enabled && config.environment === 'production' && location.protocol === 'https:' &&
    location.origin === privacyOrigins[config.surface === 'landing' ? 0 : 1] && /^G-[A-Z0-9]{5,20}$/.test(config.measurementId)
}
export function crossesPrivacyBoundary(from: string, to: string): boolean {
  return Boolean(safePage('app', from)) !== Boolean(safePage('app', to))
}
