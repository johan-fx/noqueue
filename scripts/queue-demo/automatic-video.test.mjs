import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { automaticChapters, validateAutomatic } from './automatic-video.mjs'
const required = [
  ['initial-four','replacement-Bruno','replacement-Celia','replacement-Clara','replacement-Diego','replacement-Eva','no-candidate','oversized-excluded','stopped-detail'],
  ['three-cycles','cancel-only-one','arrival-only-one','priority-exception','manual-restart','manual-stop'],
  ['subtypes','cancel-swipe-result','complete-swipe-result','subtype-priority','footer-restart','reception-end'],
  ['customer-cancel-replacement','pass-result','replacement-Elena','pool-stopped','pool-card-restart','pool-end'],
]
const evidence = () => automaticChapters.map((id,i)=>({id,queueId:`q-${i}`,status:'passed',errors:[],duration:100,videos:[{},{}],assertions:Array.from({length:5},(_,j)=>({key:`check-${j}`,actual:true,expected:true})),moments:required[i].map(event=>({event})),commands:[{status:200}],finalAutomation:{activeCycles:0}}))
test('requires independent complete verified chapters and every demonstrated branch',()=>{
  assert.doesNotThrow(()=>validateAutomatic(evidence()))
  for(const mutate of [
    e=>e.pop(), e=>e[1].queueId=e[0].queueId, e=>e[0].status='failed',
    e=>e[0].errors.push('failure'), e=>e[0].assertions[0].actual=false,
    e=>e[0].moments.pop(), e=>e[0].commands[0].status=409,
    e=>e[0].finalAutomation.activeCycles=1, e=>e[0].videos.pop(),
  ]) { const e=evidence(); mutate(e); assert.throws(()=>validateAutomatic(e)) }
})
test('recording is opt-in and does not mock business state or clocks',()=>{
  const config=readFileSync(new URL('../../tests/e2e/automatic-demo.config.ts',import.meta.url),'utf8')
  const harness=readFileSync(new URL('../../tests/e2e/demo/automatic.spec.ts',import.meta.url),'utf8')
  const runner=readFileSync(new URL('./automatic-video.mjs',import.meta.url),'utf8')
  assert.match(config,/NOQUEUE_E2E_AUTO_REPLACEMENT/)
  assert.match(config,/workers: 1/)
  assert.doesNotMatch(harness,/\.clock\.|route\.fulfill|UPDATE queue|Date\.now\s*=/)
  assert.match(harness,/assertVisiblePhase/)
  assert.match(runner,/result\.status !== 0/)
  assert.match(runner,/validateAutomatic\(chapters, selected\)/)
})

test('selected captures validate only explicitly requested chapters without claiming a complete delivery',()=>{
 const pool=evidence().slice(3); assert.doesNotThrow(()=>validateAutomatic(pool,['pool'])); assert.throws(()=>validateAutomatic(pool));
})

test('assembled evidence is immutable and failed chapters cannot be promoted', async()=>{
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { default:path } = await import('node:path')
  const { assembleAutomatic, verifyProvenance } = await import('./automatic-video.mjs')
  const root=mkdtempSync(path.join(tmpdir(),'automatic-provenance-'))
  try {
    const chapters=evidence()
    const sources=chapters.map((c,i)=>{
      const dir=path.join(root,`capture-${i}`); mkdirSync(dir)
      writeFileSync(path.join(dir,'source.json'),JSON.stringify({files:{},head:'test-only'}))
      writeFileSync(path.join(dir,`adaptive-${c.id}.json`),JSON.stringify(c)); return dir
    })
    const delivery=path.join(root,'delivery')
    assembleAutomatic(delivery,sources)
    assert.equal(verifyProvenance(delivery).chapters.length,4)
    assert.throws(()=>assembleAutomatic(delivery,sources))
    const file=path.join(sources[0],`adaptive-${chapters[0].id}.json`)
    writeFileSync(file,JSON.stringify({...chapters[0],status:'failed'}))
    assert.throws(()=>verifyProvenance(delivery),/Changed recording/)
    assert.throws(()=>assembleAutomatic(path.join(root,'failed-delivery'),sources),/Incomplete chapter/)
    writeFileSync(file,JSON.stringify(chapters[0]))
    writeFileSync(path.join(delivery,`adaptive-${chapters[1].id}.json`),'{}')
    assert.throws(()=>verifyProvenance(delivery),/Changed recording/)
  } finally { rmSync(root,{recursive:true,force:true}) }
})
