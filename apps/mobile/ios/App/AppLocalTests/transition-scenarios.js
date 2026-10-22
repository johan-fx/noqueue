// Shared end-to-end scenario for real WKWebView / Android WebView only.
// This file is a resource of AppLocalTests and is never packaged into App.app.
// Reports contain route categories and allowlisted intent values only; never URLs,
// recovery capabilities, owner credentials, names, or request bodies.
(async ({ services, venue, reducedMotionOverride = false, simulateApiUnavailable = false }) => {
  const allowedIntents = new Set(['forward', 'back', 'bottom-up', 'replace', 'none'])
  const transitionLog = []
  const dataRequests = []
  const nativeFetch = window.fetch
  const nativeStartViewTransition = document.startViewTransition
  const nativeAction = typeof window.__noqueueNativeAction === 'function'
    ? window.__noqueueNativeAction
    : null
  const nativeActions = new Set(Array.isArray(window.__noqueueNativeActions)
    ? window.__noqueueNativeActions.filter(action => typeof action === 'string')
    : [])
  const hasNativeAction = action => nativeAction !== null && nativeActions.has(action)
  const invokeNativeAction = async action => {
    check(hasNativeAction(action), `native test action ${action} is advertised`)
    await nativeAction(action)
  }
  const nativeMatchMedia = window.matchMedia.bind(window)
  const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'startViewTransition')
  const safeIntent = () => {
    const value = document.documentElement.dataset.noqueueTransitionIntent
    return allowedIntents.has(value) ? value : 'unknown'
  }
  if (reducedMotionOverride) {
    window.matchMedia = query => {
      const media = nativeMatchMedia(query)
      if (query !== '(prefers-reduced-motion: reduce)') return media
      return new Proxy(media, {
        get(target, property) {
          if (property === 'matches') return true
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
  }
  const publicEndpointPath = pathname => pathname.replace(/^\/api\/v1\/mobile(?=\/)/, '/api/v1/public')
  const endpointKind = input => {
    try {
      const rawPathname = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname
      const pathname = publicEndpointPath(rawPathname)
      if (pathname === '/api/v1/public/search') return 'public-search'
      if (/^\/api\/v1\/public\/venues\/[^/]+\/services$/.test(pathname)) return 'public-venue'
      if (/^\/api\/v1\/public\/services\/[^/]+$/.test(pathname)) return 'public-service'
      if (/^\/api\/v1\/public\/entries\/[^/]+$/.test(pathname)) return 'public-turn'
      if (pathname === '/api/v1/public/entries') return 'public-active-entries'
      if (/^\/api\/v1\/public\/entries\/[^/]+\/commands$/.test(pathname)) return 'public-turn-command'
      if (rawPathname.startsWith('/api/v1/mobile/')) return 'mobile'
    } catch { /* Do not retain an unrecognized URL. */ }
    return 'other'
  }
  const now = () => Math.round(performance.now())
  const log = (phase, intent, startedAt) => transitionLog.push({
    phase,
    intent: allowedIntents.has(intent) ? intent : 'unknown',
    elapsedMs: Math.max(0, now() - startedAt),
  })
  const check = (condition, label) => { if (!condition) throw new Error(`Transition smoke: ${label}`) }
  const wait = async (predicate, label, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Transition smoke timeout: ${label}`)
  }
  const capture = async name => {
    check(/^[a-z-]{1,32}$/.test(name), 'capture name is safe')
    if (typeof window.__noqueueCapture === 'function') await window.__noqueueCapture(name)
  }
  const transitionCount = () => transitionLog.filter(item => item.phase === 'start').length
  const waitTransitionSettled = async (baseline, label) => {
    if (!supported || reducedMotion) return
    await wait(() => transitionCount() > baseline, `${label} transition start`)
    await wait(() => {
      const started = transitionLog.filter(item => item.phase === 'start').length
      const finished = transitionLog.filter(item => item.phase === 'finished').length
      const skipped = transitionLog.filter(item => item.phase === 'finished-with-error').length
      return started > baseline && finished + skipped >= started
    }, `${label} transition finish`, 5000)
  }
  const requireTransition = async (baseline, intent, label) => {
    await waitTransitionSettled(baseline, label)
    if (!supported || reducedMotion) {
      check(transitionCount() === baseline, `${label} skips transitions when motion is unavailable or reduced`)
      return
    }
    const starts = transitionLog.filter(item => item.phase === 'start').slice(baseline)
    check(starts.length === 1, `${label} performs one visual transition`)
    if (intent) check(starts[0].intent === intent, `${label} intent is ${intent}`)
  }
  const button = name => Array.from(document.querySelectorAll('button')).find(el => {
    const label = el.getAttribute('aria-label')
    const text = el.textContent.trim().replace(/\s+/g, ' ')
    // Nested hints may be concatenated without whitespace in textContent
    // (for example "Escanear QREscanea..."). Match the visible button prefix.
    return label === name || text === name || text.startsWith(name)
  })
  const settlePreviousTransition = async () => {
    // Scripted DOM clicks bypass the browser's snapshot input blocking; model real
    // user input by waiting for completion except in the explicit rapid-link test.
    await wait(() => transitionLog.filter(item => item.phase === 'start').length <=
      transitionLog.filter(item => item.phase === 'finished' || item.phase === 'finished-with-error').length,
      'previous transition settled', 5000)
  }
  const clickButton = async name => {
    await settlePreviousTransition()
    await wait(() => button(name) && !button(name).disabled, `button ${name}`)
    button(name).click()
  }
  const clickLink = async (selector, label) => {
    await settlePreviousTransition()
    await wait(() => document.querySelector(selector), `link ${label}`)
    document.querySelector(selector).click()
  }
  const typeSearch = async value => {
    await wait(() => document.querySelector('input[aria-label="Hotel, restaurante o local"]'), 'search input')
    const input = document.querySelector('input[aria-label="Hotel, restaurante o local"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const goPop = route => {
    history.pushState({ __noqueueTransitionTest: true }, '', route)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  const delays = { path: '', milliseconds: 0, calls: 0 }
  const requestPath = input => {
    try { return publicEndpointPath(new URL(typeof input === 'string' ? input : input.url, location.origin).pathname) }
    catch { return '' }
  }
  window.fetch = async function(input, init) {
    const kind = endpointKind(input)
    if (delays.path && requestPath(input) === delays.path) {
      delays.calls += 1
      const delay = delays.milliseconds
      delays.path = ''
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    const response = await nativeFetch.call(this, input, init)
    if (kind !== 'other') dataRequests.push({ kind, method: init?.method ?? 'GET', status: response.status })
    return response
  }
  let apiOverrideApplied = true
  if (simulateApiUnavailable) {
    try {
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        writable: true,
        value: undefined,
      })
    } catch { apiOverrideApplied = false }
  }
  const availableStartViewTransition = document.startViewTransition
  if (typeof availableStartViewTransition === 'function') {
    try {
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        writable: true,
        value(updateCallback, options) {
          const intent = safeIntent()
          const startedAt = now()
          log('start', intent, startedAt)
          let transition
          try {
            transition = Reflect.apply(availableStartViewTransition, this, [updateCallback, options])
          } catch (error) {
            log('finished-with-error', intent, startedAt)
            throw error
          }
          Promise.resolve(transition.ready).then(
            () => log('ready', intent, startedAt),
            () => log('ready-with-error', intent, startedAt),
          )
          Promise.resolve(transition.finished).then(
            () => log('finished', intent, startedAt),
            () => log('finished-with-error', intent, startedAt),
          )
          return transition
        },
      })
    } catch {
      // Some WebViews may expose a non-configurable method. Navigation must still work.
    }
  }
  const installSucceeded = typeof availableStartViewTransition !== 'function' || document.startViewTransition !== availableStartViewTransition
  const apiAvailable = typeof availableStartViewTransition === 'function'
  const supported = apiAvailable && installSucceeded
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let pushedTurn = false
  let activeToken = ''
  try {
    check(window.Capacitor?.isNativePlatform(), 'requires the real native Capacitor shell')
    check(!!services?.reception && !!venue, 'local API fixtures are available')
    check(!apiAvailable || supported, 'View Transitions API is instrumentable in this WebView')
    check(!simulateApiUnavailable || apiOverrideApplied, 'test can disable the View Transitions API safely')

    // Exercise the no-API branch on a real WebView that normally supports it.
    // If the device genuinely lacks the API, the normal pass already exercises it.
    if (simulateApiUnavailable) {
      check(!apiAvailable && !reducedMotion, 'test-only no-API pass runs with ordinary motion preference')
      check(location.pathname === `/v/${venue}` && document.body.innerText.includes('Te damos la bienvenida'), 'no-API pass begins on the prepared venue')
      const baseline = transitionCount()
      await clickLink(`a[href^="/q/${services.reception}?"]`, 'venue service without View Transitions API')
      await wait(() => location.pathname === `/q/${services.reception}` && !!document.querySelector('#customer-name'), 'form without View Transitions API')
      check(transitionCount() === baseline, 'venue to form remains navigable with no View Transitions API')
      await clickLink('a[aria-label="Volver"]', 'back to venue without View Transitions API')
      await wait(() => location.pathname === `/v/${venue}` && document.body.innerText.includes('Te damos la bienvenida'), 'venue return without View Transitions API')
      check(transitionCount() === baseline, 'back remains navigable with no View Transitions API')
      return {
        status: 'passed',
        apiSupported: apiAvailable,
        instrumented: supported,
        reducedMotion,
        transitions: transitionLog,
        requestKinds: dataRequests.map(({ kind, method, status }) => ({ kind, method, status })),
        checks: ['test-only unavailable API preserves forward and backward route navigation'],
      }
    }

    // The reduced-motion pass starts from the real cancelled-turn destination of
    // the first pass. This avoids synthesizing POPs while changing the media state,
    // and verifies actual route controls without creating an additional ticket.
    if (reducedMotionOverride) {
      check(reducedMotion, 'test-local reduced-motion preference is active')
      check(location.pathname.startsWith('/t/') && document.body.innerText.includes('Ya no estás en la lista de espera'), 'reduced-motion pass starts on the cancelled test turn')
      let baseline = transitionCount()
      await clickLink('footer a[href="/?lang=es"]', 'return home from cancelled turn')
      await wait(() => location.pathname === '/' && document.body.innerText.includes('¿Dónde quieres'), 'home after leaving the waiting list')
      check(transitionCount() === baseline, 'cancelled turn to home skips transitions under reduced motion')
      await capture('reduced-home')
      if (hasNativeAction('open-venue')) await invokeNativeAction('open-venue')
      else goPop(`/v/${venue}?lang=es`)
      await wait(() => location.pathname === `/v/${venue}` && document.body.innerText.includes('Te damos la bienvenida'), 'venue under reduced motion')
      check(transitionCount() === baseline, 'home to venue skips transitions under reduced motion')
      check(!document.body.innerText.includes('Cargando…'), 'prepared venue has no intermediate placeholder')
      await capture('reduced-venue')

      await clickLink(`a[href^="/q/${services.reception}?"]`, 'venue service under reduced motion')
      await wait(() => location.pathname === `/q/${services.reception}` && !!document.querySelector('#customer-name'), 'queue form under reduced motion')
      check(transitionCount() === baseline, 'venue to form skips transitions under reduced motion')
      check(!document.body.innerText.includes('Cargando…'), 'prepared form has no intermediate placeholder')
      await capture('reduced-form')

      await clickLink('a[aria-label="Volver"]', 'back to venue under reduced motion')
      await wait(() => location.pathname === `/v/${venue}` && document.body.innerText.includes('Te damos la bienvenida'), 'venue return under reduced motion')
      check(transitionCount() === baseline, 'form back to venue skips transitions under reduced motion')
      await capture('reduced-back')
      return {
        status: 'passed',
        apiSupported: apiAvailable,
        instrumented: supported,
        reducedMotion,
        transitions: transitionLog,
        requestKinds: dataRequests.map(({ kind, method, status }) => ({ kind, method, status })),
        checks: ['reduced-motion preference suppresses forward and backward route transitions', 'real controls remain usable', 'prepared destinations have no intermediate placeholder'],
      }
    }

    if (!document.body.innerText.includes('¿Dónde quieres')) goPop('/?lang=es')
    await wait(() => !!document.querySelector('main') && document.body.innerText.includes('¿Dónde quieres'), 'native home is ready')
    check(!document.body.innerText.includes('Cargando…'), 'initial destination has no intermediate placeholder')
    await capture('home')

    // Forward: home → search.
    let baseline = transitionCount()
    await clickButton('Busca un establecimiento')
    await wait(() => location.pathname === '/search' && !!document.querySelector('input[aria-label="Hotel, restaurante o local"]'), 'search screen')
    await requireTransition(baseline, supported && !reducedMotion ? 'forward' : null, 'home to search')
    await capture('search')

    // Query changes are in-place state updates and must never start a page transition.
    const queryBaseline = transitionCount()
    const searchesBeforeTyping = dataRequests.filter(item => item.kind === 'public-search' && item.status === 200).length
    await typeSearch('Establecimiento local')
    await wait(() => dataRequests.filter(item => item.kind === 'public-search' && item.status === 200).length > searchesBeforeTyping, 'typed search committed')
    await wait(() => document.querySelector(`a[href^="/q/${services.reception}?"]`), 'search results')
    await clickButton('Restaurantes')
    await wait(() => document.querySelector(`a[href^="/q/${services.restaurant}?"]`), 'restaurant filter')
    await wait(() => document.querySelector('input[aria-label="Hotel, restaurante o local"]')?.value === 'Establecimiento local', 'search text retained')
    check(transitionCount() === queryBaseline, 'query and filter updates do not trigger route transitions')
    await new Promise(resolve => setTimeout(resolve, 5300))
    check(transitionCount() === queryBaseline, 'resource polling does not trigger route transitions')
    await capture('search-filtered')

    // Use actual Router links for forward/back, preserving the search context.
    let serviceBaseline = dataRequests.filter(item => item.kind === 'public-service').length
    baseline = transitionCount()
    await clickLink(`a[href^="/q/${services.restaurant}?"]`, 'search restaurant service')
    await wait(() => location.pathname === `/q/${services.restaurant}` && !!document.querySelector('#customer-name'), 'search queue form')
    await wait(() => dataRequests.filter(item => item.kind === 'public-service').length === serviceBaseline + 1, 'single initial service fetch')
    await requireTransition(baseline, supported && !reducedMotion ? 'forward' : null, 'search to form')
    await capture('search-form')
    baseline = transitionCount()
    await clickLink('a[aria-label="Volver"]', 'back to search')
    await wait(() => location.pathname === '/search' && document.querySelector('input[aria-label="Hotel, restaurante o local"]')?.value === 'Establecimiento local', 'search context restored')
    await requireTransition(baseline, supported && !reducedMotion ? 'back' : null, 'form back to search')
    await capture('search-back')

    // A slow venue destination exercises the real router loader without showing a loading route.
    // Native runners deliver AppUrlOpen via Android ACTION_VIEW or iOS SceneDelegate.
    // With no advertised bridge, POP tests only loader-pending/visual retention.
    delays.path = `/api/v1/public/venues/${venue}/services`
    const canUseNativeDeepLinks = hasNativeAction('open-venue') && hasNativeAction('open-service')
    delays.milliseconds = canUseNativeDeepLinks ? 2200 : 700
    baseline = transitionCount()
    if (hasNativeAction('open-venue')) await invokeNativeAction('open-venue')
    else goPop(`/v/${venue}?lang=es`)
    await wait(() => delays.calls === 1, 'slow venue request starts')
    await new Promise(resolve => setTimeout(resolve, 200))
    check(document.body.innerText.includes('Busca tu establecimiento'), 'current rendered search screen remains until the destination is prepared')
    check(!!document.querySelector('input[aria-label="Hotel, restaurante o local"]'), 'no loading placeholder replaces the current screen')
    check(transitionCount() === baseline, 'view transition does not begin while the destination loader is pending')
    if (canUseNativeDeepLinks) {
      // Supersede the delayed external venue URL with another real AppUrlOpen route.
      // Only the authorized final form may commit or start a view transition.
      const latestBaseline = transitionCount()
      await invokeNativeAction('open-service')
      await wait(() => location.pathname === `/q/${services.reception}` && !!document.querySelector('#customer-name'), 'latest external destination')
      await requireTransition(latestBaseline, supported && !reducedMotion ? 'replace' : null, 'latest external destination only')
      await new Promise(resolve => setTimeout(resolve, delays.milliseconds + 150))
      check(location.pathname === `/q/${services.reception}`, 'superseded slow venue navigation cannot replace the latest route')
      check(!document.body.innerText.includes('Te damos la bienvenida'), 'superseded venue screen never mounts after the latest destination')
      check(transitionCount() === latestBaseline + (supported && !reducedMotion ? 1 : 0), 'rapid AppUrlOpen requests create only one visual transition')
      await capture('rapid-service')
      baseline = transitionCount()
      await clickLink('a[aria-label="Volver"]', 'service back to venue')
      await wait(() => location.pathname === `/v/${venue}` && document.body.innerText.includes('Te damos la bienvenida'), 'venue from service back control')
      await requireTransition(baseline, supported && !reducedMotion ? 'back' : null, 'service back to venue')
    } else {
      await wait(() => location.pathname === `/v/${venue}` && document.body.innerText.includes('Te damos la bienvenida'), 'prepared venue destination')
    }
    await capture('venue')

    // Open the venue's actual service link, then return and re-open it. Each destination
    // request is counted by category only so paths cannot leak identifiers/capabilities.
    serviceBaseline = dataRequests.filter(item => item.kind === 'public-service').length
    baseline = transitionCount()
    await clickLink(`a[href^="/q/${services.reception}?"]`, 'venue service')
    await wait(() => location.pathname === `/q/${services.reception}` && !!document.querySelector('#customer-name'), 'queue form from venue')
    await wait(() => dataRequests.filter(item => item.kind === 'public-service').length === serviceBaseline + 1, 'single initial service fetch')
    await requireTransition(baseline, supported && !reducedMotion ? 'forward' : null, 'venue to form')
    await capture('venue-form')

    baseline = transitionCount()
    await clickLink('a[aria-label="Volver"]', 'back to venue')
    await wait(() => location.pathname === `/v/${venue}` && document.body.innerText.includes('Te damos la bienvenida'), 'venue return')
    await requireTransition(baseline, supported && !reducedMotion ? 'back' : null, 'form back to venue')
    await capture('form-back')

    // Venue intentionally has no back-to-home link. Use a test-only POP to reach
    // the home overlay phase; this does not claim to exercise native AppUrlOpen.
    goPop('/?lang=es')
    await wait(() => location.pathname === '/' && document.body.innerText.includes('¿Dónde quieres'), 'home return')
    baseline = transitionCount()
    await clickButton('Escanear QR')
    await wait(() => !!document.querySelector('[role="dialog"]'), 'scanner overlay')
    await capture('scanner-open')
    if (hasNativeAction('back-overlay')) await invokeNativeAction('back-overlay')
    else await clickButton('Volver')
    await wait(() => !document.querySelector('[role="dialog"]'), 'scanner closed')
    check(transitionCount() === baseline, 'opening and closing overlays do not transition routes')
    await capture('scanner-closed')

    // Admission replaces history but presents the full-screen turn bottom-up.
    goPop(`/v/${venue}?lang=es`)
    await wait(() => location.pathname === `/v/${venue}` && !!document.querySelector(`a[href^="/q/${services.reception}?"]`), 'venue for admission')
    baseline = transitionCount()
    await clickLink(`a[href^="/q/${services.reception}?"]`, 'admission form')
    await wait(() => location.pathname === `/q/${services.reception}` && !!document.querySelector('#customer-name'), 'admission form')
    await requireTransition(baseline, supported && !reducedMotion ? 'forward' : null, 'prepared admission form')
    const nameInput = document.querySelector('#customer-name')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(nameInput, 'Prueba transiciones local')
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(() => document.querySelector('button[type="submit"]') && !document.querySelector('button[type="submit"]').disabled, 'admission enabled')
    baseline = transitionCount()
    document.querySelector('button[type="submit"]').click()
    await wait(() => location.pathname.startsWith('/t/') && !!button('Abandonar la lista'), 'turn admitted')
    pushedTurn = true
    activeToken = location.pathname.split('/')[2] ?? ''
    await requireTransition(baseline, supported && !reducedMotion ? 'bottom-up' : null, 'form to active turn')
    await capture('turn')
    check(!document.querySelector('a[aria-label="Volver"]'), 'active waiting turn has no backward catalogue link')

    if (hasNativeAction('back-active-turn') && hasNativeAction('resume')) {
      const turnPath = location.pathname
      baseline = transitionCount()
      await invokeNativeAction('back-active-turn')
      await invokeNativeAction('resume')
      await wait(() => location.pathname === turnPath && !!button('Abandonar la lista'), 'active turn after Android Back/resume')
      check(transitionCount() === baseline, 'Android Back minimizes and resume restores the active turn without route transition')
      await capture('turn-resumed')
    }

    // A stale destination must be gated back to the owned active turn; the capability
    // is used only in memory and never included in the scenario result or logs.
    goPop('/?lang=es')
    await wait(() => location.pathname.startsWith('/t/') && location.pathname === `/t/${activeToken}`, 'active turn recovery redirect')
    check(!document.body.innerText.includes('Cargando…'), 'recovery does not show an intermediate loading route')
    await capture('recovered-turn')

    // Close the cancel sheet without mutating server state, then cancel once via the real UI.
    baseline = transitionCount()
    await clickButton('Abandonar la lista')
    await wait(() => !!document.querySelector('[role="dialog"], [role="alertdialog"]'), 'turn action sheet')
    await capture('turn-sheet-open')
    const dismiss = Array.from(document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')).find(el =>
      /Continuar en la lista de espera|Cerrar/.test(el.textContent.trim() || el.getAttribute('aria-label') || ''))
    check(!!dismiss, 'cancel sheet has a safe dismiss control')
    dismiss.click()
    await wait(() => !document.querySelector('[role="dialog"], [role="alertdialog"]'), 'turn action sheet closes')
    check(transitionCount() === baseline, 'closing a sheet does not transition routes')
    await capture('turn-sheet-closed')
    await clickButton('Abandonar la lista')
    await wait(() => !!document.querySelector('[role="dialog"], [role="alertdialog"]'), 'cancel confirmation')
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')).find(el =>
      /Sí, abandonar la lista de espera/.test(el.textContent.trim()))
    check(!!confirm, 'cancel confirmation control exists')
    confirm.click()
    await wait(() => document.body.innerText.includes('Ya no estás en la lista de espera'), 'turn cancelled')
    pushedTurn = false
    await capture('cancelled-turn')
    check(!dataRequests.some(item => item.kind === 'mobile' && item.status >= 500), 'no local mobile API failures')
    const finalCount = transitionCount()
    check(finalCount >= queryBaseline, 'transition event count is consistent')
    check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'no horizontal overflow')
    check(transitionLog.every(item => allowedIntents.has(item.intent) || item.intent === 'unknown'), 'only allowlisted transition metadata was recorded')
    return {
      status: 'passed',
      apiSupported: apiAvailable,
      instrumented: supported,
      reducedMotion,
      transitions: transitionLog,
      requestKinds: dataRequests.map(({ kind, method, status }) => ({ kind, method, status })),
      checks: [
        'native webview', 'query/filter/polling no transition', 'slow destination preparation',
        'home/search/form/back', 'venue/admission', 'replacement to active turn',
        'active-owner recovery', 'overlay/sheet no route transition', 'cancellation',
        'safe transition metadata', 'no horizontal overflow',
        ...(canUseNativeDeepLinks ? ['native AppUrlOpen route supersession'] : []),
        ...(hasNativeAction('back-overlay') ? ['Android Back dismisses overlay'] : []),
        ...(hasNativeAction('back-active-turn') && hasNativeAction('resume') ? ['Android Back minimizes/resumes active turn without navigation'] : []),
      ],
    }
  } finally {
    window.fetch = nativeFetch
    window.matchMedia = nativeMatchMedia
    if (originalDescriptor) Object.defineProperty(document, 'startViewTransition', originalDescriptor)
    else delete document.startViewTransition
    // The real admission is cancelled in normal flow; do not expose its token even on failure.
    if (pushedTurn) console.error('Transition scenario left one active test ticket; restart the ephemeral local API before rerunning.')
  }
})
