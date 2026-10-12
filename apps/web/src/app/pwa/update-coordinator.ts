import { detectRuntime } from '@/app/bootstrap/runtime'
import { reloadCurrentPage } from './browser-reload'

export type UpdateRequestErrorCode = 'offline' | 'multiple-tabs' | 'update-failed'
export type PwaLocale = 'es' | 'en'

export class PwaUpdateRequestError extends Error {
  readonly code: UpdateRequestErrorCode

  constructor(code: UpdateRequestErrorCode) {
    super(code)
    this.name = 'PwaUpdateRequestError'
    this.code = code
  }
}

export interface PwaUpdateState {
  available: boolean
  checking: boolean
  applying: boolean
  dismissed: boolean
  errorCode: UpdateRequestErrorCode | null
}

export interface PwaUpdateRuntime {
  production: boolean
  runtime: 'native' | 'web'
}

const SW_URL = '/sw.js'
const SW_SCOPE = '/'
const UPDATE_GATE_MESSAGE = 'NOQUEUE_ACTIVATE_IF_SAFE'
const UPDATE_GATE_PROTOCOL_VERSION = 1
const INSTALL_TIMEOUT_MS = 12_000
const REGISTRATION_TIMEOUT_MS = 8_000
const GATE_TIMEOUT_MS = 5_000
const NO_UPDATE_GRACE_MS = 300

const initialState: PwaUpdateState = {
  available: false,
  checking: false,
  applying: false,
  dismissed: false,
  errorCode: null,
}

let state: PwaUpdateState = { ...initialState }
let registration: ServiceWorkerRegistration | undefined
let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined
let initPromise: Promise<void> | undefined
let requestPromise: Promise<void> | undefined
let reloadStarted = false
let watchedRegistration: ServiceWorkerRegistration | undefined
let subscribers: (() => void)[] = []

function publish(nextState: PwaUpdateState): void {
  state = nextState
  for (const subscriber of subscribers) subscriber()
}

function updateState(updates: Partial<PwaUpdateState>): void {
  publish({ ...state, ...updates })
}

export function getPwaUpdateState(): PwaUpdateState {
  return state
}

export function subscribePwaUpdateState(subscriber: () => void): () => void {
  subscribers.push(subscriber)
  return () => {
    subscribers = subscribers.filter((entry) => entry !== subscriber)
  }
}

export function shouldRegisterPwaUpdates(
  environment: PwaUpdateRuntime = {
    production: import.meta.env.PROD,
    runtime: detectRuntime(),
  },
): boolean {
  return environment.production && environment.runtime === 'web'
}

export function getPwaUpdateErrorMessage(
  error: unknown,
  locale: PwaLocale = 'es',
): string {
  const code = error instanceof PwaUpdateRequestError
    ? error.code
    : isUpdateErrorCode(error)
      ? error
      : 'update-failed'

  const messages: Record<PwaLocale, Record<UpdateRequestErrorCode, string>> = {
    es: {
      offline: 'No tienes conexión. Recupera la conexión y vuelve a intentarlo.',
      'multiple-tabs': 'Cierra las otras pestañas de No Queue y vuelve a intentarlo para actualizar sin perder cambios.',
      'update-failed': 'No se pudo comprobar o aplicar la actualización. Inténtalo de nuevo.',
    },
    en: {
      offline: 'You are offline. Restore your connection and try again.',
      'multiple-tabs': 'Close the other No Queue tabs and try again to update without losing changes.',
      'update-failed': 'The update could not be checked or applied. Please try again.',
    },
  }

  return messages[locale][code]
}

function isUpdateErrorCode(value: unknown): value is UpdateRequestErrorCode {
  return value === 'offline' || value === 'multiple-tabs' || value === 'update-failed'
}

function classifyError(error: unknown): PwaUpdateRequestError {
  if (error instanceof PwaUpdateRequestError) return error
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new PwaUpdateRequestError('offline')
  }
  return new PwaUpdateRequestError('update-failed')
}

function reloadOnce(): void {
  if (reloadStarted) return
  reloadStarted = true
  reloadCurrentPage()
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new PwaUpdateRequestError('update-failed'))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function showWaitingUpdate(reg: ServiceWorkerRegistration): void {
  if (!reg.active || !reg.waiting || !navigator.serviceWorker?.controller) return
  updateState({
    available: true,
    checking: false,
    applying: false,
    dismissed: false,
    errorCode: null,
  })
}

function observeInstallation(reg: ServiceWorkerRegistration): void {
  const installing = reg.installing
  if (!installing) return

  const onStateChange = () => {
    if (installing.state === 'installed') {
      showWaitingUpdate(reg)
      installing.removeEventListener('statechange', onStateChange)
    } else if (installing.state === 'redundant' || installing.state === 'activated') {
      updateState({ checking: false, applying: false })
      installing.removeEventListener('statechange', onStateChange)
    }
  }

  installing.addEventListener('statechange', onStateChange)
  onStateChange()
}

function watchRegistration(reg: ServiceWorkerRegistration): void {
  if (watchedRegistration === reg) {
    showWaitingUpdate(reg)
    return
  }

  watchedRegistration = reg
  reg.addEventListener('updatefound', () => observeInstallation(reg))
  observeInstallation(reg)
  showWaitingUpdate(reg)
}

async function getOrRegisterServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (registration) return registration
  if (registrationPromise) return registrationPromise

  const serviceWorker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker
  if (!serviceWorker) return undefined

  registrationPromise = (async () => {
    try {
      // `none` also revalidates imported scripts, such as the activation gate,
      // rather than trusting HTTP cache entries during a version update.
      const reg = await withTimeout(
        serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' }),
        REGISTRATION_TIMEOUT_MS,
      )
      registration = reg
      watchRegistration(reg)
      return reg
    } catch (error) {
      throw classifyError(error)
    } finally {
      registrationPromise = undefined
    }
  })()

  return registrationPromise
}

/** Register a service worker only in the production browser runtime. */
export function initPwaUpdates(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    if (!shouldRegisterPwaUpdates()) return
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return

    try {
      await getOrRegisterServiceWorker()
    } catch (error) {
      const classified = classifyError(error)
      updateState({ errorCode: classified.code, checking: false })
    }
  })()

  return initPromise
}

interface InstallationMonitor {
  promise: Promise<ServiceWorker | undefined>
  found: () => boolean
  foundPromise: Promise<void>
  cancel: () => void
}

function monitorInstallation(reg: ServiceWorkerRegistration): InstallationMonitor {
  let hasFoundWorker = false
  let observedWorker: ServiceWorker | undefined
  let timeout: number | undefined
  let resolveWorker: (worker: ServiceWorker | undefined) => void = () => undefined
  let rejectWorker: (error: PwaUpdateRequestError) => void = () => undefined
  let resolveFound: () => void = () => undefined
  let settled = false

  const promise = new Promise<ServiceWorker | undefined>((resolve, reject) => {
    resolveWorker = resolve
    rejectWorker = reject
  })
  // The update call can still be in flight while a newly discovered worker
  // fails. Mark this promise handled now; consumers still observe its reject
  // when they later await it.
  void promise.catch(() => undefined)
  const foundPromise = new Promise<void>((resolve) => {
    resolveFound = resolve
  })

  const cleanup = () => {
    if (timeout !== undefined) window.clearTimeout(timeout)
    reg.removeEventListener('updatefound', onUpdateFound)
    observedWorker?.removeEventListener('statechange', onStateChange)
  }

  const finish = (worker?: ServiceWorker) => {
    if (settled) return
    settled = true
    cleanup()
    resolveWorker(worker)
  }

  const fail = () => {
    if (settled) return
    settled = true
    cleanup()
    rejectWorker(new PwaUpdateRequestError('update-failed'))
  }

  const onStateChange = () => {
    if (observedWorker?.state === 'installed') finish(observedWorker)
    else if (observedWorker?.state === 'redundant' || observedWorker?.state === 'activated') fail()
  }

  const observe = (worker: ServiceWorker | null) => {
    if (!worker || worker === observedWorker) return
    observedWorker?.removeEventListener('statechange', onStateChange)
    if (timeout !== undefined) window.clearTimeout(timeout)
    observedWorker = worker
    hasFoundWorker = true
    resolveFound()
    timeout = window.setTimeout(fail, INSTALL_TIMEOUT_MS)
    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  }

  const onUpdateFound = () => observe(reg.installing)
  reg.addEventListener('updatefound', onUpdateFound)
  observe(reg.installing)

  return {
    promise,
    found: () => hasFoundWorker,
    foundPromise,
    cancel: () => finish(),
  }
}

async function findWaitingWorker(reg: ServiceWorkerRegistration): Promise<ServiceWorker | undefined> {
  if (reg.waiting && reg.active) return reg.waiting

  const monitor = monitorInstallation(reg)
  const updateCheck = withTimeout(reg.update(), INSTALL_TIMEOUT_MS).then(
    () => ({ kind: 'checked' as const }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  const installation = monitor.promise.then(
    (worker) => ({ kind: 'installed' as const, worker }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  const first = await Promise.race([updateCheck, installation])

  if (first.kind === 'failed') {
    monitor.cancel()
    throw classifyError(first.error)
  }
  if (first.kind === 'installed') {
    if (reg.waiting && reg.active) {
      monitor.cancel()
      return reg.waiting
    }
    // A worker becoming redundant before the update check completes is a
    // failed update, not a reason to reload the old app as if it were current.
    if (first.worker?.state === 'installed' && reg.active) {
      monitor.cancel()
      throw new PwaUpdateRequestError('update-failed')
    }
    monitor.cancel()
    return undefined
  }

  if (reg.waiting && reg.active) {
    monitor.cancel()
    return reg.waiting
  }

  if (reg.installing || monitor.found()) {
    const installed = await monitor.promise
    return reg.waiting && reg.active ? reg.waiting : installed && reg.active ? installed : undefined
  }

  let graceTimeout: number | undefined
  await Promise.race([
    monitor.foundPromise,
    new Promise<void>((resolve) => {
      graceTimeout = window.setTimeout(resolve, NO_UPDATE_GRACE_MS)
    }),
  ])
  if (graceTimeout !== undefined) window.clearTimeout(graceTimeout)
  if (monitor.found()) {
    const installed = await monitor.promise
    return reg.waiting && reg.active ? reg.waiting : installed && reg.active ? installed : undefined
  }

  monitor.cancel()
  return undefined
}

interface ActivationGateReply {
  status: 'accepted' | 'blocked' | 'failed'
  reason?: 'multiple-tabs' | 'requester-not-found'
}

function askWorkerToActivate(worker: ServiceWorker): Promise<ActivationGateReply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timeout = window.setTimeout(() => {
      channel.port1.close()
      reject(new PwaUpdateRequestError('update-failed'))
    }, GATE_TIMEOUT_MS)

    channel.port1.onmessage = (event: MessageEvent<ActivationGateReply>) => {
      window.clearTimeout(timeout)
      channel.port1.close()
      if (event.data?.status === 'accepted' || event.data?.status === 'blocked') {
        resolve(event.data)
      } else {
        reject(new PwaUpdateRequestError('update-failed'))
      }
    }

    try {
      worker.postMessage({
        type: UPDATE_GATE_MESSAGE,
        protocolVersion: UPDATE_GATE_PROTOCOL_VERSION,
      }, [channel.port2])
    } catch {
      window.clearTimeout(timeout)
      channel.port1.close()
      reject(new PwaUpdateRequestError('update-failed'))
    }
  })
}

interface ActivationWaiter {
  promise: Promise<void>
  cancel: () => void
}

function waitForActivation(
  worker: ServiceWorker,
  serviceWorker: ServiceWorkerContainer,
): ActivationWaiter {
  let resolveWait: () => void = () => undefined
  let rejectWait: (error: PwaUpdateRequestError) => void = () => undefined
  let settled = false

  const promise = new Promise<void>((resolve, reject) => {
    resolveWait = resolve
    rejectWait = reject
  })
  // The target may turn redundant while the gate message is still pending.
  void promise.catch(() => undefined)

  const cleanup = () => {
    if (timeout !== undefined) window.clearTimeout(timeout)
    worker.removeEventListener('statechange', onChange)
    serviceWorker.removeEventListener('controllerchange', onChange)
  }

  const finish = () => {
    if (settled) return
    settled = true
    cleanup()
    resolveWait()
  }

  const fail = () => {
    if (settled) return
    settled = true
    cleanup()
    rejectWait(new PwaUpdateRequestError('update-failed'))
  }

  const timeout = window.setTimeout(fail, INSTALL_TIMEOUT_MS)

  const onChange = () => {
    // The script URL is the same across releases, so identify the exact worker
    // object and require both activation and control before reloading.
    if (worker.state === 'activated' && serviceWorker.controller === worker) finish()
    else if (worker.state === 'redundant') fail()
  }

  worker.addEventListener('statechange', onChange)
  serviceWorker.addEventListener('controllerchange', onChange)
  onChange()

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      cleanup()
      resolveWait()
    },
  }
}

async function requestReload(): Promise<void> {
  const serviceWorker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker
  // Native shells, development, and unsupported browsers use the same explicit
  // same-URL reload fallback. Nothing in local/session storage is removed.
  if (!shouldRegisterPwaUpdates() || !serviceWorker) {
    reloadOnce()
    return
  }

  if (navigator.onLine === false) throw new PwaUpdateRequestError('offline')
  updateState({ checking: true, applying: false, errorCode: null })

  let reg: ServiceWorkerRegistration | undefined
  try {
    reg = await getOrRegisterServiceWorker()
  } catch (error) {
    updateState({ checking: false, applying: false })
    throw classifyError(error)
  }

  if (!reg) {
    updateState({ checking: false, applying: false })
    reloadOnce()
    return
  }

  let waiting: ServiceWorker | undefined
  try {
    waiting = await findWaitingWorker(reg)
  } catch (error) {
    updateState({ checking: false, applying: false })
    throw classifyError(error)
  }

  if (!waiting || !reg.active) {
    updateState({ checking: false, applying: false, available: Boolean(reg.waiting) })
    reloadOnce()
    return
  }

  updateState({ checking: false, applying: true, available: true, errorCode: null })
  // Attach both activation and controller listeners before the activation
  // message. Activation can begin immediately when skipWaiting is requested.
  const activation = waitForActivation(waiting, serviceWorker)

  let gate: ActivationGateReply
  try {
    gate = await askWorkerToActivate(waiting)
  } catch (error) {
    activation.cancel()
    updateState({ applying: false, checking: false })
    throw classifyError(error)
  }

  if (gate.status === 'blocked') {
    activation.cancel()
    const code = gate.reason === 'multiple-tabs' ? 'multiple-tabs' : 'update-failed'
    updateState({
      available: true,
      checking: false,
      applying: false,
      errorCode: code,
    })
    throw new PwaUpdateRequestError(code)
  }

  if (gate.status !== 'accepted') {
    activation.cancel()
    updateState({ checking: false, applying: false })
    throw new PwaUpdateRequestError('update-failed')
  }

  try {
    await activation.promise
  } catch (error) {
    updateState({ checking: false, applying: false })
    throw classifyError(error)
  }

  updateState({ checking: false, applying: false, available: false, errorCode: null })
  reloadOnce()
}

/**
 * The single owner of recovery navigation. Resolves after a same-URL reload has
 * been requested; rejects with a safe code that the caller can render.
 */
export function requestAppReload(): Promise<void> {
  if (requestPromise) return requestPromise
  requestPromise = requestReload().finally(() => {
    requestPromise = undefined
  })
  return requestPromise
}

/** Apply a discovered update from the explicit in-app prompt. */
export async function applyPwaUpdate(): Promise<void> {
  try {
    await requestAppReload()
  } catch (error) {
    const classified = classifyError(error)
    updateState({
      available: Boolean(registration?.waiting),
      checking: false,
      applying: false,
      dismissed: false,
      errorCode: classified.code,
    })
  }
}

export function dismissPwaUpdate(): void {
  updateState({ dismissed: true, errorCode: null })
}

/** Retry an update check without navigating or activating. */
export async function retryPwaUpdateCheck(): Promise<void> {
  updateState({ checking: true, errorCode: null })
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    updateState({ checking: false, errorCode: 'offline' })
    return
  }
  if (!shouldRegisterPwaUpdates()) {
    updateState({ checking: false, errorCode: null })
    return
  }

  try {
    const reg = await getOrRegisterServiceWorker()
    if (!reg) {
      updateState({ checking: false, errorCode: 'update-failed' })
      return
    }

    const waiting = await findWaitingWorker(reg)
    if (waiting && reg.active) showWaitingUpdate(reg)
    else updateState({ checking: false, errorCode: null })
  } catch (error) {
    const classified = classifyError(error)
    updateState({ checking: false, errorCode: classified.code })
  }
}
