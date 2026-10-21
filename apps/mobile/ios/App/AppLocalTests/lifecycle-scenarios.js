// Test bundle ONLY. Known links are supplied by secure test storage, NOT a product history.
(async ({ phase, expected, links }) => {
  const check = (v, label) => { if (!v) throw new Error('Lifecycle: ' + label) }
  const wait = async (fn, label) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return
      await new Promise(r => setTimeout(r, 150))
    }
    throw new Error('Lifecycle timeout: ' + label)
  }
  const hash = async v => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))), b => b.toString(16).padStart(2, '0')).join('')
  check(window.Capacitor?.isNativePlatform(), 'native bridge')
  const vault = JSON.parse((await window.Capacitor.Plugins.NoQueueVault.read()).value)
  const identityDigest = await hash(vault.secret)
  check(identityDigest === expected.identityDigest && vault.pending.length === 0, 'identity and no pending intents')
  const request = async (route, identity = vault.secret, body) => {
    const r = await fetch('https://127.0.0.1:8788/api/v1/mobile' + route, {
      headers: { ...(identity ? { Authorization: 'Bearer ' + identity } : {}), ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
    })
    return { status: r.status, body: await r.json() }
  }
  const go = async route => {
    history.pushState(null, '', route + '?lang=es'); dispatchEvent(new PopStateEvent('popstate'))
    await new Promise(r => setTimeout(r, 120))
  }
  const listed = await request('/entries')
  check(listed.status === 200, 'owner list200')
  const called = phase === 'called'
  const active = listed.body.entries
  check(active.length === (called ? 4 : 0), 'only waiting/called in active list')
  if (called) {
    const hashes = await Promise.all(active.map(e => hash(e.recoveryToken)))
    check(expected.tickets.every(e => hashes.includes(e.digest)), 'same four capabilities after restart')
  }
  await go('/turns')
  await wait(() => called ? document.querySelectorAll('a[href^="/t/"]').length === 4 : document.body.innerText.includes('No tienes turnos activos'), 'home reflects active states')
  const states = []
  for (const link of links) {
    const route = '/entries/' + link.token
    const r = await request(route), c = r.body.customer
    const status = called ? 'called' : link.index === 0 ? 'completed' : 'expired'
    const customerPhase = status === 'completed' ? 'arrived' : status
    check(r.status === 200 && r.body.status === status && c.phase === customerPhase, 'owned known link correct state')
    check(c.version === (called ? 1 : 2), 'one version per transition')
    check(c.service.type === link.type, 'correct service')
    if (called) check(c.arrivalDeadlineAt > Date.now(), 'live arrival deadline')
    else {
      check(c.actions.length === 0, 'terminal actions empty')
      if (status === 'completed') check(c.arrivedAt != null, 'arrival timestamp')
      const command = await request(route + '/commands', vault.secret, { action: 'cancel', version: c.version })
      check(command.status === 409, 'terminal command rejected409')
    }
    const foreign = vault.secret === 'ab'.repeat(32) ? 'cd'.repeat(32) : 'ab'.repeat(32)
    check((await request(route, foreign)).status === 404, 'foreign link denied404')
    check((await request(route, null)).status === 401, 'no identity denied401')
    await go('/t/' + link.token)
    await wait(() => document.body.innerText.includes(called ? '¡Es tu turno!' : status === 'completed' ? 'Se ha confirmado tu llegada' : 'ha expirado'), 'actual status UI')
    check(called === document.body.innerText.includes('Abandonar la lista'), 'only active turn has cancel UI')
    states.push({ type: link.type, status, phase: customerPhase, version: c.version })
  }
  return { identityDigest, states, checks: ['owned known links200', 'foreign404 anonymous401', 'real status UI', called ? 'active list restores same tickets' : 'terminal list empty; terminal cancel409; known links still authorized'] }
})
