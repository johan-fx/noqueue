// Shared DOM scenario for real iOS WKWebView and Android Capacitor WebView.
// Resource of AppLocalTests ONLY; not shipped in App/public. Returns hashes, never credentials.
(async ({ phase, services, expected }) => {
  const origin = 'https://127.0.0.1:8788'
  const check = (condition, label) => { if (!condition) throw new Error(`Service smoke: ${label}`) }
  check(window.Capacitor?.isNativePlatform(), 'requires native bridge')
  const wait = async (fn, label) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new Error(`Service smoke timeout: ${label}`)
  }
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
  const vault = async () => JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value)
  const secret = (await vault()).secret
  const identityDigest = await hash(secret)
  if (expected) check(identityDigest === expected.identityDigest, 'identity survives restart')
  const nativeFetch = window.fetch
  const requests = []
  window.fetch = async function(input, init) {
    const response = await nativeFetch.call(this, input, init)
    if (init?.method === 'POST' && String(input).startsWith(origin + '/api/v1/mobile/')) {
      const body = JSON.parse(init.body)
      requests.push({ status: response.status, body, key: new Headers(init.headers).get('Idempotency-Key') })
      check(!('phone' in body) && !('whatsapp' in body), 'no contact fields')
      check(new Headers(init.headers).get('Authorization') === 'Bearer ' + secret, 'native owner auth')
    }
    return response
  }
  const request = async (route, body, { identity = secret, key = crypto.randomUUID() } = {}) => {
    const response = await nativeFetch(origin + '/api/v1/mobile' + route, {
      headers: { Authorization: 'Bearer ' + identity, ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
    })
    return { status: response.status, body: await response.json() }
  }
  const list = async () => { const r = await request('/entries'); check(r.status === 200, 'list200'); return r.body.entries }
  const entry = async token => { const r = await request('/entries/' + token); check(r.status === 200, 'entry200'); return r.body }
  const go = async route => {
    history.pushState(null, '', route + '?lang=es'); window.dispatchEvent(new PopStateEvent('popstate'))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const button = name => Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === name)
  const click = async name => { await wait(() => button(name) && !button(name).disabled, 'button ' + name); button(name).click(); await new Promise(r => setTimeout(r, 80)) }
  const radio = async name => {
    const el = Array.from(document.querySelectorAll('[role=radio]')).find(e => e.textContent.trim() === name)
    check(el && el.getAttribute('aria-disabled') !== 'true', 'selectable space'); el.click(); await new Promise(r => setTimeout(r, 80))
  }
  const open = async token => { await go('/t/' + token); await wait(() => button('Abandonar la lista'), 'turn controls') }
  const uiCommand = async (steps, action, status = 200) => {
    const before = requests.length
    for (const step of steps) await click(step)
    await wait(() => requests.length > before, 'command response')
    const r = requests.at(-1)
    check(r.status === status && r.body.action === action, `${action} expected${status} got${r.status}`)
    if (status === 200) await wait(() => !document.querySelector('[role=dialog]'), 'sheet closed')
    return r
  }
  try {
    if (phase === 'seed') {
      check((await list()).length === 0, 'fresh API')
      const tickets = []
      for (const type of ['restaurant', 'pool']) {
        const service = await request('/services/' + services[type])
        check(service.status === 200 && service.body.canJoin, 'fixture ' + type + ' must be active')
        for (let i = 0; i < 2; i++) {
          await go('/q/' + services[type])
          await wait(() => document.querySelector('#customer-name'), 'admission form')
          check(!document.querySelector('input[type=tel]') && !document.body.innerText.includes('WhatsApp'), 'anonymous form')
          const input = document.querySelector('#customer-name')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, `${type} local ${i}`)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          if (type === 'restaurant') {
            await click('Más comensales')
            if (i === 0) await radio('Terraza')
          } else {
            check(!button('Más comensales') && !document.querySelector('[name=customer-space]'), 'pool individual form')
          }
          const before = requests.length
          await wait(() => document.querySelector('button[type=submit]') && !document.querySelector('button[type=submit]').disabled, 'submit enabled')
          document.querySelector('button[type=submit]').click()
          await wait(() => location.pathname.startsWith('/t/') && button('Abandonar la lista'), 'admitted turn')
          check(requests.length === before + 1 && requests.at(-1).status === 201, 'exactly one admission201')
          const token = location.pathname.split('/')[2], e = await entry(token)
          check(e.customer.service.type === type && e.customer.partySize === (type === 'restaurant' ? 2 : 1), 'type and party size persisted')
          if (type === 'restaurant') check(e.customer.preferredSpaceId === (i === 0 ? 'terrace' : 'fastest'), 'space persisted')
          else check(!('receptionService' in requests.at(-1).body) && !('preferredSpaceId' in requests.at(-1).body), 'pool payload only individual fields')
          tickets.push({ type, digest: await hash(token), index: i })
        }
      }
      const invalidPool = await request('/services/' + services.pool + '/entries', { displayName: 'Invalid group', partySize: 2, locale: 'es' })
      check(invalidPool.status === 400, 'pool group admission rejected')
      check((await vault()).pending.length === 0, 'confirmed intents cleared')
      await go('/turns')
      await wait(() => document.querySelectorAll('a[href^="/t/"]').length === 4, 'four active links')
      return { identityDigest, tickets, checks: ['restaurant and pool UI admissions201', 'operational fields persisted', 'no phone/WhatsApp', 'pool group rejected400'] }
    }
    if (phase === 'empty') {
      check((await list()).length === 0 && (await vault()).pending.length === 0, 'no active tickets or pending intents')
      await go('/turns')
      await wait(() => document.body.innerText.includes('No tienes turnos activos'), 'empty after restart')
      return { identityDigest, checks: ['cancelled tickets stay absent after restart'] }
    }
    check(['restaurant', 'pool'].includes(phase), 'known phase')
    const active = await list(), wanted = expected.tickets.filter(t => phase === 'restaurant' || t.type === 'pool')
    const recoveredHashes = await Promise.all(active.map(e => hash(e.recoveryToken)))
    check(active.length === wanted.length && wanted.every(t => recoveredHashes.includes(t.digest)), 'exact original tickets recovered')
    await go('/turns')
    await wait(() => document.querySelectorAll('a[href^="/t/"]').length === wanted.length, 'recovered UI links')
    const selected = active.filter(e => e.serviceId === services[phase])
    check(selected.length === 2, 'two compatible tickets')
    const firstHash = expected.tickets.find(t => t.type === phase && t.index === 0).digest
    const first = selected[(await hash(selected[0].recoveryToken)) === firstHash ? 0 : 1].recoveryToken
    const second = selected.find(e => e.recoveryToken !== first).recoveryToken
    await open(first)
    const checks = ['identity and exact tickets recovered after process death']
    let before = await entry(first)
    const other = 'ab'.repeat(32) === secret ? 'cd'.repeat(32) : 'ab'.repeat(32)
    check((await request('/entries/' + first, undefined, { identity: other })).status === 404, 'other installation read denied')
    check((await request('/entries/' + first + '/commands', { action: 'cancel', version: before.customer.version }, { identity: other })).status === 404, 'other installation cancel denied')
    checks.push('foreign read/cancel404')
    if (phase === 'restaurant') {
      await uiCommand(['Modificar', 'Modificar número de comensales', 'Más comensales', 'Continuar', 'Confirmar'], 'update')
      let changed = await entry(first)
      check(changed.customer.partySize === 3 && changed.customer.version === before.customer.version + 1, 'party update persisted')
      await click('Modificar'); await click('Modificar sala'); await radio('Salón')
      await uiCommand(['Guardar cambios'], 'update')
      const room = await entry(first)
      check(room.customer.preferredSpaceId === 'room' && room.customer.version === changed.customer.version + 1, 'room update persisted')
      // Fastest is not a compatible successor for an inferred, explicitly chosen zone.
      // Move the second group through the real UI to the same room before yielding.
      await open(second)
      await click('Modificar'); await click('Modificar sala'); await radio('Salón')
      await uiCommand(['Guardar cambios'], 'update')
      check((await entry(second)).customer.preferredSpaceId === 'room', 'successor same room')
      await open(first)
      checks.push('UI edit party2to3 and terrace to room, compatible successor same room')
    } else {
      check(!button('Modificar') && !before.customer.actions.includes('update'), 'pool has no edit action')
      const rejected = await request('/entries/' + first + '/commands', { action: 'update', version: before.customer.version, displayName: 'Invalid edit', partySize: 2, preferredSpaceId: 'fastest', locale: 'es' })
      check(rejected.status === 409 && rejected.body.error === 'unsupported_service', 'pool edit rejected by API')
      checks.push('pool edit absent and API rejected409')
    }
    before = await entry(first)
    const secondBefore = await entry(second)
    const yielded = await uiCommand(phase === 'restaurant' ? ['Modificar', 'Pasar turno', 'Sí, pasar turno'] : ['Pasar turno', 'Sí, pasar turno'], 'yield')
    const after = await entry(first), secondAfter = await entry(second)
    check(after.customer.version === before.customer.version + 1 && secondAfter.customer.version === secondBefore.customer.version + 1, 'both versions advanced on yield')
    check(after.position > secondAfter.position, 'yield swapped relative order')
    check((await request('/entries/' + first + '/commands', yielded.body, { key: yielded.key })).status === 200, 'yield replay200')
    check((await entry(first)).customer.version === after.customer.version, 'replay does not yield twice')
    const stale = await request('/entries/' + first + '/commands', { action: 'cancel', version: before.customer.version })
    check(stale.status === 409 && stale.body.error === 'version_conflict', 'stale command rejected')
    checks.push('UI yield swaps order, replay200 no duplicate, stale version409')
    await uiCommand(phase === 'restaurant' ? ['Modificar', 'Pasar turno', 'Sí, pasar turno'] : ['Pasar turno', 'Sí, pasar turno'], 'yield', 409)
    await wait(() => document.body.innerText.includes('No hay otro'), 'no successor error')
    await click('No pasar turno')
    check((await entry(first)).customer.version === after.customer.version, 'failed yield does not mutate')
    checks.push('no compatible successor visible and nonmutating')
    for (const token of [first, second]) {
      await open(token)
      await uiCommand(['Abandonar la lista', 'Sí, abandonar la lista de espera'], 'cancel')
      check((await entry(token)).status === 'cancelled', 'cancel persisted')
    }
    await go('/turns')
    await wait(() => phase === 'pool' ? document.body.innerText.includes('No tienes turnos activos') : document.querySelectorAll('a[href^="/t/"]').length === 2, 'remaining active list')
    check((await vault()).pending.length === 0, 'no pending intent')
    return { identityDigest, checks: [...checks, 'both UI cancellations200'] }
  } finally { window.fetch = nativeFetch }
})
