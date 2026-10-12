import { describe, expect, it, vi } from 'vitest'
import gateSource from '../../../public/noqueue-update-gate.js?raw'

type GateResponse = { status: string; reason?: string; otherWindows?: number }
type GatePort = { postMessage: (response: GateResponse) => void }
type GateEvent = {
  data: { type?: string; protocolVersion?: number }
  ports: GatePort[]
  source: { id: string }
  waitUntil: (promise: Promise<unknown>) => void
}
type GateListener = (event: GateEvent) => void

function createGateHarness(snapshots: Array<Array<{ id: string }>>) {
  let listener: GateListener | undefined
  const self = {
    addEventListener: vi.fn((type: string, nextListener: GateListener) => {
      if (type === 'message') listener = nextListener
    }),
    clients: {
      matchAll: vi.fn(async (options: unknown) => {
        expect(options).toEqual({ type: 'window', includeUncontrolled: true })
        return snapshots.shift() ?? []
      }),
    },
    skipWaiting: vi.fn(async () => undefined),
  }
  new Function('self', gateSource)(self)

  return {
    self,
    async send(sourceId = 'requester', protocolVersion = 1) {
      const responses: GateResponse[] = []
      let lifetime: Promise<unknown> | undefined
      listener?.({
        data: { type: 'NOQUEUE_ACTIVATE_IF_SAFE', protocolVersion },
        ports: [{ postMessage: (response) => responses.push(response) }],
        source: { id: sourceId },
        waitUntil: (promise) => { lifetime = promise },
      })
      await lifetime
      return responses
    },
  }
}

describe('generated service-worker activation gate', () => {
  it('blocks an uncontrolled app window before calling skipWaiting', async () => {
    const harness = createGateHarness([
      [{ id: 'requester' }],
      [{ id: 'requester' }, { id: 'uncontrolled-other-tab' }],
    ])

    await expect(harness.send()).resolves.toEqual([
      { status: 'blocked', reason: 'multiple-tabs', otherWindows: 1 },
    ])
    expect(harness.self.clients.matchAll).toHaveBeenCalledTimes(2)
    expect(harness.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('fails closed if the requesting client disappears before activation', async () => {
    const harness = createGateHarness([
      [{ id: 'requester' }],
      [],
    ])

    await expect(harness.send()).resolves.toEqual([
      { status: 'failed', reason: 'requester-not-found' },
    ])
    expect(harness.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('activates exactly once only when both snapshots contain the requester alone', async () => {
    const harness = createGateHarness([
      [{ id: 'requester' }],
      [{ id: 'requester' }],
    ])

    await expect(harness.send()).resolves.toEqual([{ status: 'accepted' }])
    expect(harness.self.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('ignores an incompatible protocol message', async () => {
    const harness = createGateHarness([])
    await expect(harness.send('requester', 99)).resolves.toEqual([])
    expect(harness.self.clients.matchAll).not.toHaveBeenCalled()
    expect(harness.self.skipWaiting).not.toHaveBeenCalled()
  })
})
