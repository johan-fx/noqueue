// Test bundle ONLY. Shared by actual WKWebView and Android WebView, not browser mocks.
(async ({ services, venue }) => {
  const capture = async name => { if (window.__noqueueCapture) await window.__noqueueCapture(name) }
  const check = (ok, label) => { if (!ok) throw new Error('Discovery: ' + label) }
  const wait = async (fn, label) => {
    for (let i = 0; i < 120; i++) {
      if (await fn()) return
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error('Discovery timeout: ' + label)
  }
  check(window.Capacitor?.isNativePlatform(), 'requires native bridge')
  const select = (selector, text) => Array.from(document.querySelectorAll(selector)).find(e => (e.getAttribute('aria-label') || e.textContent.trim()) === text)
  const click = async (selector, text) => {
    await wait(() => select(selector, text) && !select(selector, text).disabled, 'control ' + text)
    select(selector, text).click()
  }
  const link = async path => {
    await wait(() => document.querySelector(`a[href^="${path}?"]`), 'link ' + path.split('/')[1])
    document.querySelector(`a[href^="${path}?"]`).click()
  }
  const fill = async (selector, value) => {
    await wait(() => document.querySelector(selector), 'field')
    const input = document.querySelector(selector)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const nativeFetch = window.fetch, metadata = []
  window.fetch = async function(input, init) {
    const response = await nativeFetch.call(this, input, init)
    if (String(input).includes('/api/v1/mobile/')) {
      const body = init?.body ? JSON.parse(init.body) : null
      metadata.push({ route: String(input).split('/mobile/')[1].split('/')[0], status: response.status,
        auth: new Headers(init?.headers).has('Authorization'), cookiesOmitted: init?.credentials === 'omit',
        ...(String(input).endsWith('/search') ? { searchText: body?.text } : {}),
        ...(body ? { hasContact: 'phone' in body || 'whatsapp' in body } : {}) })
    }
    return response
  }
  try {
    history.pushState(null, '', '/?lang=es'); dispatchEvent(new PopStateEvent('popstate'))
    await wait(() => document.querySelector('h1')?.textContent.includes('¿Dónde quieres'), 'home')
    check(document.body.innerText.includes('Escanear QR') && document.body.innerText.includes('Usar mi ubicación'), 'shared web capabilities visible')
    check(!document.querySelector('nav') && !document.body.innerText.includes('Mis turnos'), 'no native dashboard')
    await capture('01-home')
    const identity = JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value).secret
    await click('button', 'Busca un establecimiento')
    await fill('input[aria-label="Hotel, restaurante o local"]', 'Establecimiento local')
    // History updates before React's next render. Wait for the debounced request,
    // not the old global results, before clicking a filter in this DOM harness.
    await wait(() => metadata.some(m => m.searchText === 'Establecimiento local' && m.status === 200), 'search input committed')
    await wait(() => document.querySelectorAll('a[href^="/q/"]').length === 3, 'three searched services')
    await capture('02-search')
    await click('button', 'Restaurantes')
    await wait(() => document.querySelectorAll('a[href^="/q/"]').length === 1 && document.querySelector(`a[href^="/q/${services.restaurant}?"]`), 'restaurant filter')
    await capture('03-filter')
    const returnSearch = location.pathname + location.search
    check(new URLSearchParams(location.search).get('text') === 'Establecimiento local', 'typed query retained by filter')
    await link('/q/' + services.restaurant)
    await wait(() => document.querySelector('#customer-name'), 'restaurant form')
    await click('a', 'Volver')
    await wait(() => location.pathname === '/search' && document.querySelector('input[aria-label="Hotel, restaurante o local"]'), 'back search')
    check(location.pathname + location.search === returnSearch, 'text and filters preserved')
    await wait(() => document.querySelector('input[aria-label="Hotel, restaurante o local"]')?.value === 'Establecimiento local', 'search text restored')
    await click('button', 'Recepción')
    await wait(() => document.querySelectorAll('a[href^="/q/"]').length === 1 && document.querySelector(`a[href^="/q/${services.reception}?"]`), 'reception filter')
    // A venue QR/deep-link uses the same shared venue route (no invented result link).
    history.pushState(null, '', '/v/' + venue + '?lang=es'); dispatchEvent(new PopStateEvent('popstate'))
    await wait(() => document.querySelector('h1')?.textContent.includes('Te damos la bienvenida'), 'venue')
    await capture('04-venue')
    await link('/q/' + services.reception)
    await fill('#customer-name', 'Prueba discovery local')
    check(!document.querySelector('input[type=tel]') && !document.body.innerText.includes('WhatsApp'), 'anonymous mobile form')
    await capture('05-form')
    await wait(() => document.querySelector('button[type=submit]') && !document.querySelector('button[type=submit]').disabled, 'join ready')
    document.querySelector('button[type=submit]').click()
    await wait(() => location.pathname.startsWith('/t/') && select('button', 'Abandonar la lista'), 'admitted turn')
    await capture('06-turn')
    const activePath = location.pathname
    check(!select('a', 'Volver') && !document.querySelector('nav'), 'active turn has no catalogue navigation')
    history.pushState(null, '', '/?lang=es'); dispatchEvent(new PopStateEvent('popstate'))
    await wait(() => location.pathname === activePath && select('button', 'Abandonar la lista'), 'automatic recovery')
    history.pushState(null, '', '/q/' + services.pool + '?lang=es'); dispatchEvent(new PopStateEvent('popstate'))
    await wait(() => location.pathname === activePath && select('button', 'Abandonar la lista'), 'other service cannot replace active turn')
    await click('button', 'Abandonar la lista')
    await click('button', 'Sí, abandonar la lista de espera')
    await wait(() => metadata.some(m => m.route === 'entries' && m.status === 200) && !select('button', 'Sí, abandonar la lista de espera'), 'cancel completed')
    await wait(() => document.body.innerText.includes('Ya no estás en la lista de espera'), 'terminal confirmation retained')
    await click('a', 'Seleccionar lista de espera')
    await wait(() => document.querySelector('h1')?.textContent.includes('Te damos la bienvenida'), 'catalogue unlocked after cancel')
    check(JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value).secret === identity, 'identity preserved across discovery and turn')
    check(metadata.some(m => m.route === 'search' && m.status === 200), 'real search API')
    check(metadata.some(m => m.route === 'venues' && m.status === 200), 'real venue API')
    check(metadata.some(m => m.route === 'services' && m.status === 201), 'one committed admission')
    check(metadata.every(m => m.auth && m.cookiesOmitted && !m.hasContact), 'authenticated traffic without cookies or WhatsApp')
    check(!metadata.some(m => m.route === 'push'), 'push stays off')
    history.pushState(null, '', '/?lang=es'); dispatchEvent(new PopStateEvent('popstate'))
    await wait(() => document.querySelector('h1')?.textContent.includes('¿Dónde quieres'), 'final home')
    check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'no horizontal page overflow')
    return { status: 'passed', search: true, filter: true, venue: true, returnContext: true, admission: true, recovery: true, cancellation: true, identityPreserved: true, pushRequests: 0 }
  } finally { window.fetch = nativeFetch }
})
