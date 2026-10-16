import { CONSENT_DAYS, PRIVACY_REVISION, isPrivacyConsent, type PrivacyConsent } from '@noqueue/contracts/privacy-policy'
import { productionEligible, safePage, type PrivacyConfig } from './policy'

export const STATE_KEY = 'noqueue.privacy.v1'
export const CMP_KEY = 'noqueue.cookieconsent'
const lifetime = CONSENT_DAYS * 86400000
export type ConsentState = PrivacyConsent & { expiresAt: number; acknowledged: boolean; attempts: number }
export interface AnalyticsTransport {
  start(id: string, remainingSeconds: number, page: { location: string; title: string }): void
  view(page: { location: string; title: string }): void
  stop(): void
  clearCookies(): void
}
export interface PrivacyPorts {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  location: () => Pick<Location, 'origin' | 'protocol' | 'pathname'>
  now: () => number
  uuid: () => string
  receipt: (body: PrivacyConsent) => Promise<boolean>
  analytics: AnalyticsTransport
}
export function parseState(raw: string | null, now: number): ConsentState | null {
  try {
    const data = JSON.parse(raw ?? 'null')
    if (!data || typeof data.expiresAt !== 'number' || data.expiresAt <= now || data.expiresAt > now + lifetime ||
      typeof data.acknowledged !== 'boolean' || !Number.isInteger(data.attempts) || data.attempts < 0 || data.attempts > 3) return null
    const { expiresAt, acknowledged, attempts, ...receipt } = data
    return isPrivacyConsent(receipt) ? { ...receipt, expiresAt, acknowledged, attempts } : null
  } catch { return null }
}

/** Sole gate to analytics. UI callbacks never talk to gtag directly. */
export class PrivacyController {
  private lastPath: string | null = null
  private observedPath: string | null = null
  private active = false
  private suspended = false
  private sending = new Set<string>()
  readonly config: PrivacyConfig
  private ports: PrivacyPorts
  private storageFailed = false
  constructor(config: PrivacyConfig, ports: PrivacyPorts) { this.config = config; this.ports = ports }
  get eligible() { return productionEligible(this.config, this.ports.location()) }
  get state() {
    try { return parseState(this.ports.storage.getItem(STATE_KEY), this.ports.now()) } catch { return null }
  }
  private save(state: ConsentState): boolean {
    try {
      const value = JSON.stringify(state)
      this.ports.storage.setItem(STATE_KEY, value)
      return this.ports.storage.getItem(STATE_KEY) === value
    } catch { return false }
  }
  async choose(analytics: boolean, locale: 'es' | 'en') {
    this.disable()
    this.storageFailed = true
    const state: ConsentState = {
      consentId: this.state?.consentId ?? this.ports.uuid(), decisionId: this.ports.uuid(),
      revision: PRIVACY_REVISION, locale, analytics, expiresAt: this.ports.now() + lifetime,
      acknowledged: false, attempts: 0,
    }
    if (!this.save(state)) return
    this.storageFailed = false
    await this.retry()
  }
  async retry() {
    const state = this.state
    if (!this.eligible || !state || state.acknowledged || state.attempts >= 3 || this.sending.has(state.decisionId)) return
    const attempt = { ...state, attempts: state.attempts + 1 }
    if (!this.save(attempt)) return
    this.sending.add(state.decisionId)
    const { expiresAt: _expires, acknowledged: _ack, attempts: _attempts, ...body } = state
    try {
      const ok = await this.ports.receipt(body)
      const current = this.state
      // A withdrawal/new choice in this or another tab always wins over a late ACK.
      if (ok && current?.decisionId === state.decisionId) this.save({ ...current, acknowledged: true })
    } catch { /* Fail closed; retry only the bounded pending receipt, not events. */ }
    finally { this.sending.delete(state.decisionId) }
    this.refresh()
  }
  private observeNavigation() {
    const path = this.ports.location().pathname
    if (this.observedPath !== path) this.lastPath = null
    this.observedPath = path
  }
  refresh() {
    this.observeNavigation()
    const state = this.state, location = this.ports.location(), page = safePage(this.config.surface, location.pathname)
    if (this.storageFailed || this.suspended || !this.eligible || !state?.analytics || !state.acknowledged || !page) {
      this.disable(!state?.analytics || !this.eligible, !this.suspended)
      return
    }
    const safe = { location: location.origin + page.path, title: page.title }
    if (!this.active) {
      this.ports.analytics.start(this.config.measurementId, Math.max(1, Math.floor((state.expiresAt - this.ports.now()) / 1000)), safe)
      this.active = true
    }
    // Raw path is only compared in memory: never sent or persisted. Query/hash changes don't count.
    if (this.lastPath !== location.pathname) {
      this.lastPath = location.pathname
      this.ports.analytics.view(safe)
    }
  }
  suspend() { this.observeNavigation(); this.suspended = true; this.disable(false, false) }
  resume(restoredNavigation = false) {
    if (restoredNavigation) this.lastPath = null
    this.suspended = false; this.refresh()
  }
  private disable(clear = true, forgetView = true) {
    this.ports.analytics.stop()
    if (clear) this.ports.analytics.clearCookies()
    this.active = false
    if (forgetView) this.lastPath = null
  }
}
