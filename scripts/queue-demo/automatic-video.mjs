import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { preflight } from './lib.mjs'
import { compose, sourceSnapshot, archiveTestSources, assertSource } from './adaptive-video.mjs'
export const automaticChapters = ['restaurant-chain','restaurant-parallel','reception','pool']
const required = {
  'restaurant-chain': ['initial-four','replacement-Bruno','replacement-Celia','replacement-Clara','replacement-Diego','replacement-Eva','no-candidate','oversized-excluded','stopped-detail'],
  'restaurant-parallel': ['three-cycles','cancel-only-one','arrival-only-one','priority-exception','manual-restart','manual-stop'],
  reception: ['subtypes','cancel-swipe-result','complete-swipe-result','subtype-priority','footer-restart','reception-end'],
  pool: ['customer-cancel-replacement','pass-result','replacement-Elena','pool-stopped','pool-card-restart','pool-end'],
}
export function validateAutomatic(chapters, expectedIds = automaticChapters) {
  if (JSON.stringify(chapters.map(c=>c.id)) !== JSON.stringify(expectedIds)) throw new Error('Four ordered automatic chapters required')
  if (new Set(chapters.map(c=>c.queueId)).size !== expectedIds.length) throw new Error('Independent queues required')
  for (const c of chapters) {
    if (c.status !== 'passed' || c.errors.length || c.duration < 10 || c.videos.length !== 2) throw new Error(`Incomplete chapter: ${c.id}`)
    if (c.assertions.length < 5 || c.assertions.some(a=>a.actual === undefined || JSON.stringify(a.actual)!==JSON.stringify(a.expected))) throw new Error(`Failed assertions: ${c.id}`)
    if (required[c.id].some(event=>!c.moments.some(m=>m.event===event))) throw new Error(`Missing coverage: ${c.id}`)
    if (c.commands.length===0 || c.commands.some(c=>c.status<200||c.status>=300)) throw new Error(`Failed command: ${c.id}`)
    if (c.finalAutomation.activeCycles !== 0) throw new Error(`Active cycle left: ${c.id}`)
  }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function verifyProvenance(directory) {
  const file = path.join(directory,'recording-provenance.json')
  if (!existsSync(file)) return null
  const provenance = JSON.parse(readFileSync(file,'utf8'))
  if (JSON.stringify(provenance.chapters.map(c=>c.id)) !== JSON.stringify(automaticChapters)) throw new Error('Incomplete provenance')
  for (const c of provenance.chapters) {
    const source = readFileSync(c.sourceFile), chapter = readFileSync(c.chapterFile)
    if (hash(source)!==c.sourceHash || hash(chapter)!==c.chapterHash || hash(readFileSync(path.join(directory,`adaptive-${c.id}.json`)))!==c.chapterHash) throw new Error(`Changed recording evidence: ${c.id}`)
    assertSource(JSON.parse(source))
  }
  return provenance
}
export function assembleAutomatic(directory, sources) {
  if (sources.length !== 4 || existsSync(path.join(directory,'source.json'))) throw new Error('Four explicit source directories and fresh delivery directory required')
  let application
  const chapters = [], evidence = []
  const provenance = { policy:'Only independently passed chapters are selected. Failed attempts remain in original run directories and are never relabelled.', chapters:[] }
  for (const [i,dir] of sources.entries()) {
    const id = automaticChapters[i], sourceFile = path.resolve(dir,'source.json'), chapterFile = path.resolve(dir,`adaptive-${id}.json`)
    const sourceBytes = readFileSync(sourceFile), chapterBytes = readFileSync(chapterFile)
    const source = JSON.parse(sourceBytes)
    assertSource(source)
    const fingerprint = JSON.stringify(Object.entries(source.files).filter(([p])=>!p.startsWith('tests/e2e/')))
    if (application && application !== fingerprint) throw new Error('Application source differs across recordings')
    application = fingerprint
    chapters.push(JSON.parse(chapterBytes)); evidence.push({id,chapterBytes})
    provenance.chapters.push({id,sourceFile,chapterFile,sourceHash:hash(sourceBytes),chapterHash:hash(chapterBytes),status:chapters.at(-1).status})
  }
  validateAutomatic(chapters)
  mkdirSync(directory,{recursive:true,mode:0o700})
  writeFileSync(path.join(directory,'source.json'),readFileSync(provenance.chapters[0].sourceFile))
  for (const c of evidence) writeFileSync(path.join(directory,`adaptive-${c.id}.json`),c.chapterBytes)
  writeFileSync(path.join(directory,'recording-provenance.json'),JSON.stringify(provenance,null,2))
  verifyProvenance(directory)
}
const root = fileURLToPath(new URL('../../',import.meta.url))
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'record'
  const directory = path.resolve(process.argv[3] ?? path.join(root,'queue-demo-output',`automatic-${new Date().toISOString().replaceAll(':','-')}`))
  if (!['record','capture','assemble','compose'].includes(mode)) throw new Error('Use record, capture, assemble or compose')
  const selected = mode === 'capture' ? automaticChapters.filter(id=>process.argv.slice(4).includes(id)) : automaticChapters
  if (!selected.length || (mode === 'capture' && process.argv.slice(4).some(id=>!automaticChapters.includes(id)))) throw new Error('Supply known chapter IDs after capture directory')
  preflight(); process.umask(0o077)
  if (mode === 'record' || mode === 'capture') {
    if (existsSync(path.join(directory,'source.json'))) throw new Error('Use a fresh recording directory; existing evidence is immutable')
    mkdirSync(directory,{recursive:true,mode:0o700})
    writeFileSync(path.join(directory,'source.json'),JSON.stringify(archiveTestSources(sourceSnapshot(),directory),null,2))
    const result = spawnSync('pnpm',['--filter','@noqueue/e2e','exec','playwright','test','--config=automatic-demo.config.ts',...(mode === 'capture' ? ['--grep', `automatic real clock: (${selected.join('|')})$`] : [])],{cwd:root,stdio:'inherit',env:{...process.env,NOQUEUE_E2E_AUTO_REPLACEMENT:'true',QUEUE_DEMO_DIR:directory,QUEUE_REPORT_DIR:path.join(directory,'reports')}})
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Recording failed (${result.status}); no final video published. Evidence: ${directory}`)
  }
  if (mode === 'assemble') assembleAutomatic(directory,process.argv.slice(4))
  const provenance = verifyProvenance(directory)
  const chapters = selected.map(id=>JSON.parse(readFileSync(path.join(directory,`adaptive-${id}.json`),'utf8')))
  validateAutomatic(chapters, selected)
  assertSource(JSON.parse(readFileSync(path.join(directory,'source.json'),'utf8')))
  if (mode === 'capture') {
    writeFileSync(path.join(directory,'capture.json'),JSON.stringify({status:'passed',chapters:selected},null,2))
    console.log(`Verified captures: ${selected.join(', ')}; no final video composed`); process.exit(0)
  }
  const result = compose(directory,automaticChapters)
  verifyProvenance(directory)
  const report = {
    recordingProvenance: provenance ? `Four independently passed chapters selected from ${new Set(provenance.chapters.map(c=>path.dirname(c.sourceFile))).size} isolated capture batches; original failed attempts excluded and preserved separately.` : 'Single isolated capture batch.',
    status: result.status, scope:'Four recorded scenarios, not an exhaustive test of all operational failures.',
    clock:'Real server/browser clock. Only idle wait interiors are accelerated x20 in resumen.mp4.',
    setup:'Fictional entries enrolled off-camera through public API; automatic mode and demo grace configured before capture. All demonstrated staff/client actions use real UI.',
    notes:[
      'Priority is an explicit exception to size/FIFO: compatible priority-ranked entries precede non-prioritized entries, without exceeding initial capacity.',
      'Staff cancellation stops its cycle; cancellation by the called customer offers the slot to the next compatible entry.',
      'Camera on right switches between named customers; captions name the viewed customer.',
      'The final footer detail in the user brief was truncated; video shows current implemented footer.',
    ],
    chapters:result.chapters.map(c=>({id:c.id,realSeconds:c.realSeconds,editedSeconds:c.editedSeconds,assertionCount:c.assertions.length,moments:c.moments.map(({event,caption,editedAt})=>({event,caption,editedAt}))})),
  }
  writeFileSync(path.join(directory,'verification-public.json'),JSON.stringify(report,null,2))
  console.log(`Verified automatic demo: ${directory}/resumen.mp4`)
}
