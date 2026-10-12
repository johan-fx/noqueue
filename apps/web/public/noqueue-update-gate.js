/*
 * Imported into Workbox's generated service worker. New workers stay waiting
 * until an explicit request from one page confirms no other same-origin
 * window clients are open. In particular, never broadcast a reload to tabs
 * that could contain unsaved form input.
 */
self.addEventListener('message', (event) => {
  if (
    event.data?.type !== 'NOQUEUE_ACTIVATE_IF_SAFE' ||
    event.data?.protocolVersion !== 1
  ) return

  event.waitUntil((async () => {
    const replyPort = event.ports?.[0]
    const requester = event.source

    if (!replyPort || !requester || typeof requester.id !== 'string') {
      replyPort?.postMessage({ status: 'failed' })
      return
    }

    try {
      // includeUncontrolled is essential: a page in a just-opened tab might
      // not yet be controlled by this registration but still runs old code.
      const options = {
        type: 'window',
        includeUncontrolled: true,
      }
      const windows = await self.clients.matchAll(options)
      const requesterIsOpen = windows.some((client) => client.id === requester.id)
      const otherWindows = windows.filter((client) => client.id !== requester.id)

      if (!requesterIsOpen) {
        replyPort.postMessage({ status: 'failed', reason: 'requester-not-found' })
        return
      }

      if (otherWindows.length > 0) {
        replyPort.postMessage({
          status: 'blocked',
          reason: 'multiple-tabs',
          otherWindows: otherWindows.length,
        })
        return
      }

      // Recheck immediately before activation. Browser clients cannot be
      // locked atomically, so a tab can still open after this final snapshot;
      // this narrows (but does not eliminate) that unavoidable race.
      const latestWindows = await self.clients.matchAll(options)
      if (!latestWindows.some((client) => client.id === requester.id)) {
        replyPort.postMessage({ status: 'failed', reason: 'requester-not-found' })
        return
      }

      const latestOtherWindows = latestWindows.filter((client) => client.id !== requester.id)
      if (latestOtherWindows.length > 0) {
        replyPort.postMessage({
          status: 'blocked',
          reason: 'multiple-tabs',
          otherWindows: latestOtherWindows.length,
        })
        return
      }

      replyPort.postMessage({ status: 'accepted' })
      await self.skipWaiting()
    } catch {
      replyPort.postMessage({ status: 'failed' })
    }
  })())
})
