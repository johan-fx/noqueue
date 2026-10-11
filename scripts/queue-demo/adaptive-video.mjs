import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflight, markerEnd, calibratedOffset } from './lib.mjs'

export const chapterIds = ['baseline','protection','learning','offline','expiration']
export function playbackSpans(chapter, accelerated = true) {
  if (!Number.isFinite(chapter.duration) || chapter.duration <= 0) throw new Error('Invalid duration')
  let last = 0, previousEnd = 0
  const result=[]
  for (const w of chapter.waits ?? []) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < previousEnd || w.end <= w.start || w.end > chapter.duration || w.speed !== 12) throw new Error('Invalid real wait')
    previousEnd = w.end
    // Retain both sides of every transition at 1x; confirmed moments also hold 5s.
    // Only the exported playback accelerates; the recorded wait was real time.
    const a=w.start+2
    let b=w.end-3
    // Keep discovered discrepancies at normal speed, including four seconds before.
    for(const finding of chapter.reviewFindings ?? []) if(finding.at >= a && finding.at <= w.end) b=Math.min(b,finding.at-4)
    if (accelerated && b > a+5) {
      if (a>last) result.push({start:last,end:a,speed:1})
      result.push({start:a,end:b,speed:20}); last=b
    }
  }
  result.push({start:last,end:chapter.duration,speed:1})
  return result
}
export const durationOf = spans => spans.reduce((s,p)=>s+(p.end-p.start)/p.speed,0)
export function editedAt(spans, time) {
  return spans.reduce((sum,p)=>sum+Math.max(0,Math.min(time,p.end)-p.start)/p.speed,0)
}
const root = fileURLToPath(new URL('../../', import.meta.url))
const run = (bin,args,options={})=>execFileSync(bin,args,{encoding:'utf8',maxBuffer:32*1024*1024,...options})
const esc = s=>s.replaceAll('\\','\\\\').replaceAll("'",'’').replaceAll(':','\\:').replaceAll('%','\\%')
export function sourceSnapshot() {
  const files={}
  const paths=run('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root}).split('\0').filter(p=> /^(apps|packages|tests\/e2e)\//.test(p) && /\.(ts|tsx|sql|json|jsonc|css|mjs)$/.test(p)).sort()
  for (const p of paths) { try {files[p]=createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex')} catch(e) {if(e.code!=='ENOENT')throw e} }
  return {head:run('git',['rev-parse','HEAD'],{cwd:root}).trim(),files}
}
export function archiveTestSources(source, directory) {
  const archive=path.join(directory,'recorded-test-sources')
  for(const [p,hash] of Object.entries(source.files)) {
    if(!p.startsWith('tests/e2e/'))continue
    const content=readFileSync(path.join(root,p))
    if(createHash('sha256').update(content).digest('hex')!==hash)throw new Error(`Cannot archive changed recording harness: ${p}`)
    mkdirSync(path.dirname(path.join(archive,p)),{recursive:true,mode:0o700})
    writeFileSync(path.join(archive,p),content)
  }
  return {...source, archivedTestSourcesDirectory:archive}
}
export function assertSource(source) {
  for(const [p,hash] of Object.entries(source.files)) {
    // Application/contract/migration code must still match the running build.
    // A harness may be repaired after a run; its exact recorded version remains auditable.
    const selected=p.startsWith('tests/e2e/') && source.archivedTestSourcesDirectory ? path.join(source.archivedTestSourcesDirectory,p) : path.join(root,p)
    if(createHash('sha256').update(readFileSync(selected)).digest('hex')!==hash) throw new Error(`Recorded source changed: ${p}`)
  }
}
export function compose(directory, selectedIds = chapterIds, prefix = '') {
  process.umask(0o077)
  const bins=preflight(), source=JSON.parse(readFileSync(path.join(directory,'source.json'),'utf8'))
  assertSource(source)
  for(const name of ['baseline-source.json','learning-source.json']) {
    try { assertSource(JSON.parse(readFileSync(path.join(directory,name),'utf8'))) } catch (e) { if(e.code!=='ENOENT') throw e }
  }
  let review={}
  try {review=JSON.parse(readFileSync(path.join(directory,'review-findings.json'),'utf8'))} catch(e){if(e.code!=='ENOENT')throw e}
  const chapters=selectedIds.map(id=>{const recorded=JSON.parse(readFileSync(path.join(directory,`adaptive-${id}.json`),'utf8'));return {...recorded,reviewFindings:[...(recorded.reviewFindings??[]),...(review[id]??[])]}})
  const probe=f=>JSON.parse(run(bins.ffprobe,['-v','error','-show_format','-show_streams','-of','json',f]))
  const encode=(args,out)=>run(bins.ffmpeg,['-v','error','-y','-filter_complex_threads','2',...args,'-an','-r','25','-c:v','libx264','-threads','2','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',out])
  const outputs=[], chaptersSummary=[]
  for (const c of chapters) {
    if(c.duration<=0 || c.videos?.length!==2) throw new Error(`No usable footage: ${c.id}`)
    for(const v of c.videos) {
      const pixels=run(bins.ffmpeg,['-v','error','-i',v.path,'-vf','fps=25,crop=2:2:194:422,scale=1:1,format=rgb24','-f','rawvideo','-'],{encoding:null})
      v.offset=calibratedOffset(markerEnd(pixels),v.afterMarker)
      const p=probe(v.path),stream=p.streams.find(s=>s.codec_type==='video')
      if(stream?.width!==390 || stream?.height!==844 || Number(p.format.duration)<v.offset+c.duration-.15)throw new Error('Incomplete raw video')
    }
    const f=[]
    for(let i=0;i<2;i++)f.push(`[${i}:v]trim=start=${c.videos[i].offset}:duration=${c.duration},setpts=PTS-STARTPTS,fps=25,setsar=1,pad=960:1080:285:118:color=0x101827[s${i}]`)
    let overlays="[s0][s1]hstack=inputs=2,drawtext=text='PERSONAL':fontcolor=white:fontsize=28:x=400:y=44,drawtext=text='CLIENTE':fontcolor=white:fontsize=28:x=1340:y=44"
    // Timecode is burned at real-time rate before any editorial speed-up.
    overlays+=",drawtext=text='Tiempo real del capítulo %{pts\\:hms}':fontcolor=0xfbbf24:fontsize=21:x=(w-tw)/2:y=83"
    for(let i=0;i<c.moments.length;i++) {
      const m=c.moments[i],end=c.moments[i+1]?.at??c.duration
      overlays+=`,drawtext=text='${esc(m.caption)}':fontcolor=white:fontsize=23:x=(w-tw)/2:y=995:enable='gte(t,${m.at})*lt(t,${end})'`
    }
    overlays+=",drawtext=text='Datos ficticios · Servidor local · Sin mensajes reales · Reloj sin trucar':fontcolor=0xadb7c9:fontsize=20:x=(w-tw)/2:y=1040"
    for(const finding of c.reviewFindings) {
      const enable=`between(t,${Math.max(0,finding.at-2)},${Math.min(c.duration,finding.at+8)})`
      overlays+=`,drawbox=x=0:y=980:w=1920:h=48:color=0x101827:t=fill:enable='${enable}',drawtext=text='${esc(finding.caption)}':fontcolor=0xff7777:fontsize=25:x=(w-tw)/2:y=995:enable='${enable}'`
    }
    if(c.status!=='passed'||c.reviewFindings.length) overlays+=",drawtext=text='INCIDENCIA DETECTADA - consultar informe':fontcolor=0xff6666:fontsize=22:x=20:y=15"
    f.push(overlays+'[out]')
    const original=path.join(directory,`${c.id}-real.mp4`)
    encode([...c.videos.flatMap(v=>['-i',v.path]),'-filter_complex',f.join(';'),'-map','[out]','-t',String(c.duration)],original)
    const spans=playbackSpans(c), branches=spans.map((_,i)=>`b${i}`), filters=[]
    if(spans.length>1) filters.push(`[0:v]split=${spans.length}${branches.map(b=>`[${b}]`).join('')}`)
    spans.forEach((s,i)=>filters.push(`[${spans.length>1?branches[i]:'0:v'}]trim=start=${s.start}:end=${s.end},setpts=(PTS-STARTPTS)/${s.speed},fps=25,drawtext=text='${s.speed===1?'Velocidad normal':'Espera acelerada x20'}':fontcolor=0xfbbf24:fontsize=21:x=20:y=82[p${i}]`))
    filters.push(spans.map((_,i)=>`[p${i}]`).join('')+`concat=n=${spans.length}:v=1:a=0[out]`)
    const edited=path.join(directory,`${c.id}-resumen.mp4`)
    encode(['-i',original,'-filter_complex',filters.join(';'),'-map','[out]','-t',String(durationOf(spans))],edited)
    outputs.push({original,edited})
    chaptersSummary.push({id:c.id,status:c.reviewFindings.length?'observed-with-failures':c.status,recordingStatus:c.status,reviewFindings:c.reviewFindings,realSeconds:c.duration,editedSeconds:durationOf(spans),spans,moments:c.moments.map(m=>({...m,editedAt:editedAt(spans,m.at)})),assertions:c.assertions,errors:c.errors})
    console.log(`Composed ${c.id}: ${c.duration.toFixed(1)} real seconds → ${durationOf(spans).toFixed(1)} seconds`)
  }
  const finals=[]
  for(const kind of ['original','edited']) {
    const list=path.join(directory,`${kind}-concat.txt`)
    writeFileSync(list,outputs.map(o=>`file '${o[kind].replaceAll("'", "'\\''")}'`).join('\n'))
    const pending=path.join(directory,prefix+(kind==='original'?'flujo-completo.pending.mp4':'resumen.pending.mp4'))
    run(bins.ffmpeg,['-v','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',pending])
    const p=probe(pending),v=p.streams.find(s=>s.codec_type==='video')
    const expected=chaptersSummary.reduce((s,c)=>s+(kind==='original'?c.realSeconds:c.editedSeconds),0)
    if(v?.codec_name!=='h264'||v.width!==1920||v.height!==1080||v.r_frame_rate!=='25/1'||Math.abs(Number(p.format.duration)-expected)>1 ||p.streams.some(s=>s.codec_type==='audio'))throw new Error('Final encoding validation failed')
    run(bins.ffmpeg,['-v','error','-xerror','-i',pending,'-f','null','-'])
    finals.push({pending,path:pending.replace('.pending',''),duration:Number(p.format.duration),kind})
  }
  assertSource(source)
  for(const v of finals)renameSync(v.pending,v.path)
  const manifest={status:chapters.every(c=>c.status==='passed'&&!c.reviewFindings.length)?'passed':'observed-with-failures',sourceHead:source.head,sourceVerified:true,sourceVerification:'Application/contracts/migrations match current files; recording harness hashes verified against archived versions when present',alignmentToleranceSeconds:.15,outputs:finals.map(({pending,...v})=>v),chapters:chaptersSummary}
  writeFileSync(path.join(directory,prefix+'delivery.json'),JSON.stringify(manifest,null,2))
  writeFileSync(path.join(directory,prefix+'aligned-evidence.json'),JSON.stringify(chapters,null,2))
  console.log(JSON.stringify(manifest.outputs,null,2))
  return manifest
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const mode=process.argv[2]??'record'
  const directory=path.resolve(process.argv[3]??path.join(root,'queue-demo-output',`adaptive-${new Date().toISOString().replaceAll(':','-')}`))
  if(mode==='record') {
    preflight();process.umask(0o077);mkdirSync(directory,{recursive:true,mode:0o700})
    writeFileSync(path.join(directory,'source.json'),JSON.stringify(archiveTestSources(sourceSnapshot(),directory),null,2))
    const baseline=spawnSync('pnpm',['--filter','@noqueue/e2e','exec','playwright','test','--config=baseline-demo.config.ts','--workers=1','--retries=0'],{cwd:root,stdio:'inherit',env:{...process.env,QUEUE_DEMO_ADAPTIVE:'1',QUEUE_DEMO_DIR:directory,QUEUE_REPORT_DIR:path.join(directory,'reports')}})
    if(baseline.error)throw baseline.error
    const result=spawnSync('pnpm',['--filter','@noqueue/e2e','exec','playwright','test','--config=demo.config.ts','--workers=1','--retries=0'],{cwd:root,stdio:'inherit',env:{...process.env,QUEUE_DEMO_ADAPTIVE:'1',QUEUE_DEMO_DIR:directory,QUEUE_REPORT_DIR:path.join(directory,'reports')}})
    if(result.error)throw result.error
    console.log(`Recording exit status: ${result.status}; any discrepancies remain visible.`)
    compose(directory)
    if(result.status!==0 || baseline.status!==0)process.exitCode=1
  }else if(mode==='compose')compose(directory)
  else throw new Error('Use record or compose')
}
