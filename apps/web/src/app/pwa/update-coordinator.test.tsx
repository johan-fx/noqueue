import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNative: false,
  reload: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.isNative },
}))
vi.mock('./browser-reload', () => ({ reloadCurrentPage: mocks.reload }))

class MockEventTarget extends EventTarget {
  dispatch(type: string, data?: unknown) {
    const event = new Event(type) as Event & { data?: unknown }
    if (data !== undefined) Object.defineProperty(event, 'data', { value: data })
    this.dispatchEvent(event)
  }
}

class FakePort {
  peer?: FakePort
  onmessage: ((event: { data: unknown }) => void) | null = null

  postMessage(data: unknown) {
    this.peer?.onmessage?.({ data })
  }

  close() {}
}

class FakeMessageChannel {
  port1 = new FakePort()
  port2 = new FakePort()

  constructor() {
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

class FakeWorker extends MockEventTarget {
  state: ServiceWorkerState
  readonly scriptURL = 'https://noqueue.test/sw.js'
  gateResponder?: (port: FakePort, message: unknown) => void
  readonly postMessage = vi.fn((message: unknown, transfer?: Transferable[]) => {
    const port = transfer?.[0] as unknown as FakePort | undefined
    if (port) this.gateResponder?.(port, message)
  })

  constructor(state: ServiceWorkerState) {
    super()
    this.state = state
  }

  setState(state: ServiceWorkerState) {
    this.state = state
    this.dispatch('statechange')
  }
}

class FakeRegistration extends MockEventTarget {
  active: FakeWorker | null = null
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  readonly update = vi.fn(async () => undefined)
}

class FakeServiceWorkerContainer extends MockEventTarget {
  controller: FakeWorker | null = null
  registration: FakeRegistration
  readonly register = vi.fn(async () => this.registration as unknown as ServiceWorkerRegistration)

  constructor(registration = new FakeRegistration()) {
    super()
    this.registration = registration
  }
}

let originalServiceWorker: PropertyDescriptor | undefined
let serviceWorkerDescriptorCaptured = false
let originalOnLine: PropertyDescriptor | undefined
let onLineDescriptorCaptured = false

function installServiceWorker(container: FakeServiceWorkerContainer | undefined) {
  if (!serviceWorkerDescriptorCaptured) {
    originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
    serviceWorkerDescriptorCaptured = true
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  })
}

function setOnline(isOnline: boolean) {
  if (!onLineDescriptorCaptured) {
    originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    onLineDescriptorCaptured = true
  }
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: isOnline })
}

function setupWaitingUpdate() {
  const oldWorker = new FakeWorker('activated')
  const newWorker = new FakeWorker('installed')
  const registration = new FakeRegistration()
  registration.active = oldWorker
  registration.waiting = newWorker
  const container = new FakeServiceWorkerContainer(registration)
  container.controller = oldWorker
  installServiceWorker(container)
  return { oldWorker, newWorker, registration, container }
}

async function loadCoordinator() {
  return import('./update-coordinator')
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('PROD', true)
  vi.stubGlobal('MessageChannel', FakeMessageChannel)
  mocks.isNative = false
  mocks.reload.mockReset()
})

afterEach(() => {
  cleanup()
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
  } else if (serviceWorkerDescriptorCaptured) {
    Reflect.deleteProperty(navigator, 'serviceWorker')
  }
  originalServiceWorker = undefined
  serviceWorkerDescriptorCaptured = false
  if (originalOnLine) {
    Object.defineProperty(navigator, 'onLine', originalOnLine)
  } else if (onLineDescriptorCaptured) {
    Reflect.deleteProperty(navigator, 'onLine')
  }
  originalOnLine = undefined
  onLineDescriptorCaptured = false
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('PWA update runtime guard', () => {
  it('registers only for production web, never native or development', async () => {
    const api = await loadCoordinator()
    expect(api.shouldRegisterPwaUpdates({ production: true, runtime: 'web' })).toBe(true)
    expect(api.shouldRegisterPwaUpdates({ production: false, runtime: 'web' })).toBe(false)
    expect(api.shouldRegisterPwaUpdates({ production: true, runtime: 'native' })).toBe(false)

    const { container } = setupWaitingUpdate()
    vi.stubEnv('PROD', false)
    await api.initPwaUpdates()
    expect(container.register).not.toHaveBeenCalled()

    vi.resetModules()
    vi.stubEnv('PROD', true)
    mocks.isNative = true
    const nativeApi = await loadCoordinator()
    await nativeApi.initPwaUpdates()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('configures updateViaCache none when registering a production web worker', async () => {
    const { container } = setupWaitingUpdate()
    const api = await loadCoordinator()
    await api.initPwaUpdates()
    expect(container.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
  })

  it('exposes a registration error to the banner and allows a retry', async () => {
    const registration = new FakeRegistration()
    const container = new FakeServiceWorkerContainer(registration)
    container.register.mockRejectedValueOnce(new TypeError('network unavailable'))
    installServiceWorker(container)
    const api = await loadCoordinator()

    await api.initPwaUpdates()
    expect(api.getPwaUpdateState().errorCode).toBe('update-failed')
    await api.retryPwaUpdateCheck()
    expect(api.getPwaUpdateState().errorCode).toBeNull()
    expect(container.register).toHaveBeenCalledTimes(2)
  })

  it('does not register a native or development worker from the public retry helper', async () => {
    const { container } = setupWaitingUpdate()
    const api = await loadCoordinator()
    vi.stubEnv('PROD', false)
    await api.retryPwaUpdateCheck()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('does not register a worker from the public retry helper in a native shell', async () => {
    const { container } = setupWaitingUpdate()
    const api = await loadCoordinator()
    mocks.isNative = true
    await api.retryPwaUpdateCheck()
    expect(container.register).not.toHaveBeenCalled()
  })
})

describe('requestAppReload', () => {
  it('reloads the same page once when no service worker is available', async () => {
    installServiceWorker(undefined)
    const api = await loadCoordinator()
    await Promise.all([api.requestAppReload(), api.requestAppReload()])
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })

  it('reloads after an update check finds no waiting worker', async () => {
    const registration = new FakeRegistration()
    registration.active = new FakeWorker('activated')
    const container = new FakeServiceWorkerContainer(registration)
    container.controller = registration.active
    installServiceWorker(container)
    const api = await loadCoordinator()

    await api.requestAppReload()
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })

  it('does not activate while any other app window is open', async () => {
    const { newWorker, container } = setupWaitingUpdate()
    newWorker.gateResponder = (port) => port.postMessage({ status: 'blocked', reason: 'multiple-tabs' })
    const api = await loadCoordinator()
    await api.initPwaUpdates()

    await expect(api.requestAppReload()).rejects.toMatchObject({ code: 'multiple-tabs' })
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(api.getPwaUpdateState().errorCode).toBe('multiple-tabs')
    expect(newWorker.postMessage).toHaveBeenCalledWith(
      { type: 'NOQUEUE_ACTIVATE_IF_SAFE', protocolVersion: 1 },
      expect.any(Array),
    )
    expect(container.controller).not.toBe(newWorker)
  })

  it('activates, waits for the exact worker to control this tab, then reloads once', async () => {
    const { newWorker, container } = setupWaitingUpdate()
    newWorker.gateResponder = (port) => {
      newWorker.setState('activated')
      container.controller = newWorker
      container.dispatch('controllerchange')
      port.postMessage({ status: 'accepted' })
    }
    const api = await loadCoordinator()
    await api.initPwaUpdates()

    await api.requestAppReload()
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload for an activated worker until that exact worker controls the tab', async () => {
    vi.useFakeTimers()
    const { newWorker, container } = setupWaitingUpdate()
    newWorker.gateResponder = (port) => {
      newWorker.setState('activated')
      // Old and new SW script URLs are identical; controller identity matters.
      port.postMessage({ status: 'accepted' })
    }
    const api = await loadCoordinator()
    await api.initPwaUpdates()

    const pending = api.requestAppReload()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'update-failed' })
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(12_001)
    await rejected
    expect(container.controller).not.toBe(newWorker)
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('rejects an activation that turns redundant before the worker replies', async () => {
    const { newWorker } = setupWaitingUpdate()
    newWorker.gateResponder = (port) => {
      newWorker.setState('redundant')
      port.postMessage({ status: 'accepted' })
    }
    const api = await loadCoordinator()
    await api.initPwaUpdates()

    await expect(api.requestAppReload()).rejects.toMatchObject({ code: 'update-failed' })
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('fails a missing activation-gate response without reloading', async () => {
    vi.useFakeTimers()
    const { newWorker } = setupWaitingUpdate()
    const api = await loadCoordinator()
    await api.initPwaUpdates()

    const pending = api.requestAppReload()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'update-failed' })
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_001)
    await rejected
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(newWorker.postMessage).toHaveBeenCalledTimes(1)
    // Failure cancels the scoped activation waiter instead of leaving an
    // unhandled rejection or a delayed second navigation behind.
    await vi.advanceTimersByTimeAsync(12_001)
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('fails visibly instead of activating a waiting update while offline', async () => {
    const { newWorker } = setupWaitingUpdate()
    setOnline(false)
    const api = await loadCoordinator()
    await api.initPwaUpdates()

    await expect(api.requestAppReload()).rejects.toMatchObject({ code: 'offline' })
    expect(newWorker.postMessage).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('times out a stalled update check and permits a later retry', async () => {
    vi.useFakeTimers()
    const registration = new FakeRegistration()
    registration.active = new FakeWorker('activated')
    registration.update.mockImplementation(() => new Promise(() => undefined))
    const container = new FakeServiceWorkerContainer(registration)
    container.controller = registration.active
    installServiceWorker(container)
    const api = await loadCoordinator()

    const pending = api.requestAppReload()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'update-failed' })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(12_001)
    await rejected
    expect(mocks.reload).not.toHaveBeenCalled()

    registration.update.mockResolvedValueOnce(undefined)
    const retry = api.requestAppReload()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(301)
    await retry
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })

  it('times out a stalled service-worker registration and permits a later retry', async () => {
    vi.useFakeTimers()
    const registration = new FakeRegistration()
    const container = new FakeServiceWorkerContainer(registration)
    container.register.mockImplementation(() => new Promise(() => undefined))
    installServiceWorker(container)
    const api = await loadCoordinator()

    const pending = api.requestAppReload()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'update-failed' })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(8_001)
    await rejected
    expect(mocks.reload).not.toHaveBeenCalled()

    container.register.mockResolvedValueOnce(registration as unknown as ServiceWorkerRegistration)
    const retry = api.requestAppReload()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(301)
    await retry
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })

  it('rejects a worker that becomes redundant before the update check resolves', async () => {
    vi.useFakeTimers()
    const registration = new FakeRegistration()
    registration.active = new FakeWorker('activated')
    const installing = new FakeWorker('installing')
    registration.installing = installing
    registration.update.mockImplementation(() => new Promise((resolve) => {
      window.setTimeout(resolve, 10_000)
    }))
    const container = new FakeServiceWorkerContainer(registration)
    container.controller = registration.active
    installServiceWorker(container)
    const api = await loadCoordinator()

    const pending = api.requestAppReload()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'update-failed' })
    await Promise.resolve()
    installing.setState('redundant')
    await rejected
    expect(mocks.reload).not.toHaveBeenCalled()
  })
})

describe('PwaUpdateBanner', () => {
  it('offers Later without activating or reloading and warns before current-tab refresh', async () => {
    const { newWorker } = setupWaitingUpdate()
    const api = await loadCoordinator()
    await api.initPwaUpdates()
    const { PwaUpdateBanner } = await import('./PwaUpdateBanner')
    render(<PwaUpdateBanner />)

    expect(screen.getByTestId('pwa-update-banner')).toHaveTextContent('Termina o guarda tus cambios')
    expect(screen.getByTestId('pwa-update-apply')).toHaveTextContent('Actualizar ahora')
    fireEvent.click(screen.getByTestId('pwa-update-later'))
    await waitFor(() => expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument())
    expect(newWorker.postMessage).not.toHaveBeenCalled()
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('shows retry and dismiss controls when registration fails', async () => {
    const container = new FakeServiceWorkerContainer()
    container.register.mockRejectedValue(new TypeError('offline'))
    installServiceWorker(container)
    const api = await loadCoordinator()
    await api.initPwaUpdates()
    const { PwaUpdateBanner } = await import('./PwaUpdateBanner')
    render(<PwaUpdateBanner />)

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo comprobar')
    expect(screen.getByTestId('pwa-update-retry')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('pwa-update-later'))
    expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument()
  })
})
