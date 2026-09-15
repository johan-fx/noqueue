// MSW imports its WebSocket broadcast transport even in HTTP-only fixtures.
// workerd has no BroadcastChannel. Fail if the unused transport is ever exercised.
class HttpOnlyBroadcastChannel extends EventTarget {
  constructor(readonly name: string) {
    super()
  }
  postMessage(): never {
    throw new Error(
      'WebSocket broadcasting is outside this HTTP-only test harness',
    )
  }
  close() {}
  unref() {}
}
Object.defineProperty(globalThis, 'BroadcastChannel', {
  value: HttpOnlyBroadcastChannel,
  configurable: true,
})
