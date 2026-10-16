import { describe, expect, it, vi } from 'vitest'
import { PrivacyController, STATE_KEY, parseState } from '../src/controller'
import { productionEligible, safePage, crossesPrivacyBoundary, type PrivacyConfig } from '../src/policy'
const config: PrivacyConfig = { surface: 'app', environment: 'production', enabled: true, measurementId: 'G-TEST12345', native: false }
function fixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  let now = Date.now(), path = '/q/venue-id'
  const analytics = { start: vi.fn(), view: vi.fn(), stop: vi.fn(), clearCookies: vi.fn() }
  const receipt = vi.fn(async () => true)
  const controller = new PrivacyController(config, { storage, location: () => ({ origin: 'https://app.noqueue-app.com', protocol: 'https:', pathname: path }), now: () => now, uuid: () => crypto.randomUUID(), analytics, receipt })
  return { controller, analytics, storage, receipt, values, advance: (ms: number) => { now += ms }, path: (p: string) => { path = p } }
}
describe('fail-closed consent gate', () => {
  it('starts only after receipt acknowledgement and sends sanitized current page once', async () => {
    const f = fixture(); let ack!: (ok: boolean) => void
    f.receipt.mockImplementation(() => new Promise((resolve) => { ack = resolve }))
    f.controller.refresh(); expect(f.analytics.start).not.toHaveBeenCalled()
    const pending = f.controller.choose(true, 'es')
    expect(f.analytics.start).not.toHaveBeenCalled()
    f.path('/v/private-id'); ack(true); await pending
    f.controller.refresh(); f.controller.refresh()
    expect(f.analytics.start).toHaveBeenCalledTimes(1)
    expect(f.analytics.view).toHaveBeenCalledExactlyOnceWith({ location: 'https://app.noqueue-app.com/v/venue', title: 'Venue' })
    expect(JSON.stringify(f.controller.state)).not.toContain('private-id')
  })
  it('rejects immediately and a late acceptance ACK cannot resurrect analytics', async () => {
    const f = fixture(); let ack!: (ok: boolean) => void
    f.receipt.mockImplementationOnce(() => new Promise((resolve) => { ack = resolve }))
    const grant = f.controller.choose(true, 'en')
    await f.controller.choose(false, 'en'); ack(true); await grant
    f.controller.refresh()
    expect(f.analytics.start).not.toHaveBeenCalled(); expect(f.controller.state?.analytics).toBe(false)
  })
  it('retries receipts at most three times, never events, and remains off on failure', async () => {
    const f = fixture(); f.receipt.mockResolvedValue(false)
    await f.controller.choose(true, 'es')
    for (let i = 0; i < 5; i++) await f.controller.retry()
    expect(f.receipt).toHaveBeenCalledTimes(3); expect(f.analytics.view).not.toHaveBeenCalled()
  })
  it('expires both choices after 180 days without renewal', async () => {
    const f = fixture(); await f.controller.choose(true, 'es'); const expiry = f.controller.state!.expiresAt
    f.advance(86400000); f.controller.refresh(); expect(f.controller.state!.expiresAt).toBe(expiry)
    f.advance(180 * 86400000); f.controller.refresh(); expect(f.controller.state).toBeNull(); expect(f.analytics.clearCookies).toHaveBeenCalled()
  })
  it('stays off when withdrawal cannot be persisted', async () => {
    const f = fixture(); await f.controller.choose(true, 'es'); f.analytics.start.mockClear()
    f.storage.setItem = () => { throw Error('denied') }
    await f.controller.choose(false, 'es'); f.controller.refresh()
    expect(f.analytics.start).not.toHaveBeenCalled()
  })
  it('honors another tab withdrawal and excluded routes', async () => {
    const f = fixture(); await f.controller.choose(true, 'es'); f.analytics.view.mockClear()
    f.path('/t/' + 'a'.repeat(64)); f.controller.refresh(); expect(f.analytics.view).not.toHaveBeenCalled()
    f.values.set(STATE_KEY, JSON.stringify({ ...f.controller.state, analytics: false })); f.path('/'); f.controller.refresh()
    expect(f.analytics.view).not.toHaveBeenCalled()
  })
  it('rejects invalid revisions, additional fields and invalid storage', async () => {
    const f = fixture(); await f.controller.choose(true, 'es'); const state = f.controller.state!
    for (const bad of [{ ...state, revision: 2 }, { ...state, url: '/t/secret' }, { ...state, expiresAt: 0 }]) expect(parseState(JSON.stringify(bad), Date.now())).toBeNull()
    expect(parseState('broken', Date.now())).toBeNull()
  })
})
it('uses exact environment/origin/runtime gates and closed route allowlist', () => {
  const location = { origin: 'https://app.noqueue-app.com', protocol: 'https:' }
  expect(productionEligible(config, location)).toBe(true)
  for (const patch of [{ native: true }, { environment: 'staging' }, { enabled: false }, { measurementId: '' }]) expect(productionEligible({ ...config, ...patch }, location)).toBe(false)
  for (const origin of ['https://staging.noqueue-app.com', 'https://noqueue-app.com', 'https://app.noqueue-app.com.evil.test', 'http://app.noqueue-app.com']) expect(productionEligible(config, { ...location, origin })).toBe(false)
  for (const path of ['/t/token', '/login', '/staff', '/settings', '/q/x/kiosk', '/q/x/qr', '/q/demo-queue', '/v/demo-venue', '/q/confirmation-experiment', '/demo', '/privacy', '/error', '/search/']) expect(safePage('app', path)).toBeNull()
  expect(safePage('landing', '/search')).toBeNull(); expect(crossesPrivacyBoundary('/q/x', '/t/token')).toBe(true)
  expect(crossesPrivacyBoundary('/', '/search')).toBe(false)
})

it('does not duplicate a view after polling error recovery, but counts actual return navigation/BFCache', async () => {
  const f = fixture(); await f.controller.choose(true, 'es')
  f.controller.suspend(); f.controller.refresh(); f.controller.resume()
  expect(f.analytics.view).toHaveBeenCalledTimes(1)
  f.path('/v/unavailable'); f.controller.suspend()
  f.path('/q/venue-id'); f.controller.resume()
  expect(f.analytics.view).toHaveBeenCalledTimes(2)
  f.controller.suspend(); f.controller.resume(true)
  expect(f.analytics.view).toHaveBeenCalledTimes(3)
})
