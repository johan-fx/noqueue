import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import * as lib from './lib.mjs'
const phases = ['waiting', 'approaching', 'called', 'arrived', 'cancelled', 'expired']
function evidence(type = 'reception') {
  const chapters = ['main', 'alternatives', 'expiration'].map((id, index) => ({ id, fixture: { queueId: `queue-${index}`, venueId: `venue-${index}`, graceMinutes: id === 'expiration' ? 1 : type === 'restaurant' ? 5 : 2 }, duration: 40, cuts: [], videos: [{role:'staff',path:`s${index}.webm`,offset:4}, {role:'customer',path:`c${index}.webm`,offset:2}], moments: [{event:'chapter',caption:'Capítulo de prueba',at:0,hold:5}], assertions: [{key:'chapter',actual:id,expected:id}] }))
  const assertions = [...phases.map(phase=>({key:`phase:${phase}`,actual:phase,expected:phase})), ...['discovery','form','yield','cancel','deadline'].map(key=>({key,actual:true,expected:true}))]
  if (type === 'restaurant') assertions.push(...['edit:party','edit:space','resource:released'].map(key=>({key,actual:true,expected:true})))
  return {status:'passed',type,chapters,assertions}
}
test('preflight checks existing binary capabilities, never installs', () => {
  assert.throws(()=>lib.preflight(()=>{throw new Error('ENOENT')}), /No tools were installed/)
  const calls=[]; lib.preflight((bin,args)=>{calls.push([bin,args]); return 'libx264 scale pad hstack drawtext trim setpts fps format crop concat'}, {FFMPEG_PATH:'/local/ffmpeg',FFPROBE_PATH:'/local/ffprobe'})
  assert.equal(calls[0][0],'/local/ffmpeg'); assert.equal(calls[2][0],'/local/ffprobe')
})
test('CLI selects one service or sequential all; order aliases reception',()=>{
  assert.deepEqual(lib.selectServices(['order']),['reception'])
  assert.deepEqual(lib.selectServices(['all']),['restaurant','reception','pool'])
  assert.throws(()=>lib.selectServices(['unknown']))
})
test('structured service evidence fails closed on omissions or unverified assertions',()=>{
  lib.validateEvidence(evidence()); lib.validateEvidence(evidence('restaurant'))
  for(const alter of [e=>e.status='failed',e=>e.assertions.pop(),e=>e.assertions[0].actual='fake',e=>e.chapters.pop(),e=>e.chapters[0].videos.reverse(),e=>e.chapters[0].moments[0].hold=4]) {
    const e=evidence(); alter(e); assert.throws(()=>lib.validateEvidence(e))
  }
})
test('different raw startup offsets are valid; chapter cuts preserve real playback',()=>{
  const e=evidence(); e.chapters[2].duration=100; e.chapters[2].cuts=[{start:10,end:65,label:'Ha transcurrido tiempo · Demo configurada a 1 minuto'}]; e.chapters[2].moments.push({event:'expiry',caption:'Turno caducado',at:70,hold:5})
  const args=lib.composition(e), filter=args[args.indexOf('-filter_complex')+1]
  assert.match(filter,/trim=start=4:end=44/); assert.match(filter,/trim=start=2:end=42/)
  assert.match(filter,/concat=n=3/); assert.equal(lib.outputDuration(e),125)
  assert.ok(args.includes('-an')); assert.ok(args.includes('25')); assert.match(filter,/Ha transcurrido tiempo/)
  assert.throws(()=>lib.validateEvidence({...e,chapters:e.chapters.map(c=>({...c,cuts:[{start:0,end:35,label:'bad'}]}))}))
})
test('calibration requires completed marker and independently normalizes timelines',()=>{
  assert.equal(lib.markerEnd(Buffer.from([255,0,255,255,0,255,0,0,0])),.08)
  assert.throws(()=>lib.markerEnd(Buffer.from([255,0,255])), /marker/)
  assert.equal(lib.calibratedOffset(.8,1.2),2)
  assert.equal(lib.calibratedOffset(3.2,1.2),4.4)
})
test('runner checks stable source, full decode and stages entire batch before final rename',()=>{
  const source=readFileSync('scripts/queue-demo/run.mjs','utf8')
  assert.match(source,/assertStableSource/); assert.match(source,/'-f', 'null'/)
  assert.ok(source.indexOf('for (const item of staged)')>source.indexOf('full decode'))
  assert.throws(()=>lib.assertStableSource({sha256:'a'},{sha256:'b'}),/Source changed/)
})
test('demo remains opt-in, exactly three isolated tests and old helper defaults untouched',()=>{
  const config=readFileSync('tests/e2e/demo.config.ts','utf8'), flow=readFileSync('tests/e2e/demo/queue-order.spec.ts','utf8')
  assert.match(config,/testDir: '.\/demo'/); assert.match(config,/retries: 0/); assert.match(config,/workers: 1/)
  assert.match(flow,/\['restaurant', 'reception', 'pool'\]/)
  const pkg=JSON.parse(readFileSync('package.json'))
  for(const name of ['restaurant','reception','pool','all']) assert.match(pkg.scripts[`demo:queue:${name}`],new RegExp(name))
})
test('missing binaries stop before browser startup and never announce success',()=>{
  const result=spawnSync(process.execPath,['scripts/queue-demo/run.mjs','all'],{encoding:'utf8',env:{...process.env,FFMPEG_PATH:'/nonexistent/ffmpeg',FFPROBE_PATH:'/nonexistent/ffprobe'}})
  assert.equal(result.status,1); assert.match(result.stderr,/No tools were installed/); assert.doesNotMatch(result.stdout,/Verified local demo|Running .*test/)
})
test('phase keys cannot be satisfied by matching but invented values',()=>{
  const e=evidence(); e.assertions[0]={key:'phase:waiting',actual:'fabricated',expected:'fabricated'}
  assert.throws(()=>lib.validateEvidence(e),/phase/)
})
test('restaurant space edit uses its actual save action',()=>{
  const flow=readFileSync('tests/e2e/demo/queue-order.spec.ts','utf8')
  assert.match(flow,/moment\('edit-space'[^\n]*\n\s*await client.getByRole\('button', \{ name: 'Guardar cambios'/)
})

test('chapters must use independent fixture identities and normal main grace',()=>{
  const e=evidence(); e.chapters[1].fixture.queueId=e.chapters[0].fixture.queueId
  assert.throws(()=>lib.validateEvidence(e),/independent/)
  const wrong=evidence(); wrong.chapters[0].fixture.graceMinutes=1
  assert.throws(()=>lib.validateEvidence(wrong),/grace/)
})
test('retained screen time uses the five-second minimum, not nominal timer equality',()=>{
  const e=evidence()
  const c=e.chapters[2]
  c.duration=100
  c.moments=[{event:'deadline',caption:'Plazo real de llegada',at:29.189875416,hold:6},{event:'expiry',caption:'Caducado',at:89.8,hold:8}]
  c.cuts=[{start:35.189529166,end:89.5521205,label:'Ha transcurrido el plazo'}]
  // Actual retained countdown is 5.99965375 s despite the nominal 6 s request.
  lib.validateEvidence(e)
  const unsafe=structuredClone(e)
  unsafe.chapters[2].cuts[0].start=34.189875415
  assert.throws(()=>lib.validateEvidence(unsafe),/five-second/)
  const removed=structuredClone(e)
  removed.chapters[2].cuts[0].start=29
  assert.throws(()=>lib.validateEvidence(removed),/five-second/)
})
test('called proof rejects a persistent progress label and requires actual heading plus countdown',async()=>{
  const { assertVisiblePhase } = await import('../../tests/e2e/demo/visible-proof.ts')
  const { createRequire } = await import('node:module')
  const { chromium } = createRequire(new URL('../../tests/e2e/package.json',import.meta.url))('@playwright/test')
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}})
    await page.setContent('<h1>Ya casi es tu turno</h1><div aria-label="Progreso del turno">¡Es tu turno!</div>')
    await assert.rejects(()=>assertVisiblePhase(page,'called','Hotel Test',200))
    await page.setContent('<h1>¡Es tu turno!</h1><div aria-label="Progreso del turno">¡Es tu turno!</div>')
    await assert.rejects(()=>assertVisiblePhase(page,'called','Hotel Test',200))
    await page.setContent('<h1>¡Es tu turno!</h1><div aria-label="Progreso del turno">¡Es tu turno!</div><p>0:58</p><p>minutos para llegar</p>')
    const proof=await assertVisiblePhase(page,'called','Hotel Test',1000)
    assert.equal(proof.heading,'¡Es tu turno!'); assert.equal(proof.countdown,'0:58')
  } finally { await browser.close() }
})
test('row proof centers both adjacent rows above the nested footer clipping edge',async()=>{
  const { ensureRowsInViewport } = await import('../../tests/e2e/demo/visible-proof.ts')
  const { createRequire } = await import('node:module')
  const { chromium, expect } = createRequire(new URL('../../tests/e2e/package.json',import.meta.url))('@playwright/test')
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}})
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;overflow:hidden}section{position:fixed;top:97px;left:1px;width:389px;height:651px;overflow-y:auto;padding:24px;clip-path:inset(0 0 1px 0)}header{height:210px}ul{margin:0;padding:0}li{height:102px;border:1px solid black;margin-bottom:8px;width:341px;list-style:none}footer{position:fixed;top:747px;height:97px;width:390px}</style><section><header>Queue controls</header><ul>${[1,2,3,4,5].map(i=>`<li id="row-${i}"><p>Customer ${i}</p><span aria-label="Posición ${i}">${i}</span><button>Assign turn</button></li>`).join('')}</ul></section><footer>Assign next</footer>`)
    const successor=page.locator('#row-4'), customer=page.locator('#row-5')
    // Model the one-pixel inner-scroll/footer clip independently of layout bounds.
    await customer.evaluate(element=>{ element.parentElement.parentElement.scrollTop=element.offsetTop+element.offsetHeight-651 })
    await customer.scrollIntoViewIfNeeded()
    await assert.rejects(()=>expect(customer).toBeInViewport({ratio:1,timeout:200}))
    const proof=await ensureRowsInViewport([successor,customer],1000)
    assert.equal(proof.length,2)
    assert.ok(proof.every(box=>box.y>=97&&box.y+box.height<=747&&box.x>=0&&box.x+box.width<=390))
    for(const [row,position] of [[successor,4],[customer,5]]) {
      await expect(row.getByLabel(`Posición ${position}`)).toBeInViewport({ratio:1})
      await expect(row.getByRole('button')).toBeInViewport({ratio:1})
    }
  } finally { await browser.close() }
})
test('quick fixtures align opening state through fresh-token lifecycle and prove staff header',()=>{
  const source=readFileSync('tests/e2e/demo/fixtures.ts','utf8')
  assert.match(source,/for \(const action of \['pause', 'resume'\]\)/)
  assert.match(source,/effective.queueState\)\.toBe\('active'\)/)
  assert.match(source,/effective.canJoin\)\.toBe\(true\)/)
  assert.match(source,/currentQueue!\.open\)\.toBe\(1\)/)
  assert.match(source,/getByText\('Abierto', \{ exact: true \}\)/)
})
test('recorded flow requires rendered phase proof and full exchanged-row proof before holds',()=>{
  const flow=readFileSync('tests/e2e/demo/queue-order.spec.ts','utf8')
  assert.match(flow,/assertVisiblePhase\(client, value, t.venueName\)/)
  assert.doesNotMatch(flow,/client.getByText\(phases\[value\]\)/)
  assert.match(flow,/ensureRowsInViewport\(\[row\('Sucesor Compatible'\), row\(name\)\]\)/)
})
