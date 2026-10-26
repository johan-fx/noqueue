// Bounded vocabulary only: never URLs, IDs, query/body, cookies or error text.
export class StaffReadTrace {
  private phaseName = 'request'
  private since = Date.now()
  private readonly requestId = crypto.randomUUID()
  constructor(private readonly enabled: boolean, private readonly route: string) {
    this.emit('start')
  }
  private emit(state: string, status?: number) {
    if (this.enabled) console.info({
      event: 'staff_read_phase', requestId: this.requestId, route: this.route,
      phase: this.phaseName, state, durationMs: Date.now() - this.since,
      ...(status === undefined ? {} : { status }),
    })
  }
  phase(name: 'auth_init' | 'session' | 'user_d1' | 'handler_d1' | 'coordinator' | 'entries_d1') {
    this.emit('end')
    this.phaseName = name
    this.since = Date.now()
    this.emit('start')
  }
  finish(status: number) { this.emit('end', status) }
}

export function staffReadRoute(path: string) {
  if (path.endsWith('/staff/me')) return 'me'
  if (/\/staff\/venues\/[^/]+\/queues$/.test(path)) return 'catalogue'
  if (/\/staff\/queues\/[^/]+\/entries$/.test(path)) return 'entries'
  if (/\/staff\/queues\/[^/]+\/automation$/.test(path)) return 'automation'
  return null
}
