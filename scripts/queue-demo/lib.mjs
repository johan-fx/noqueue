import { execFileSync } from 'node:child_process'

export function preflight(run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), env = process.env) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg', ffprobe = env.FFPROBE_PATH || 'ffprobe'
  try {
    const encoders = run(ffmpeg, ['-hide_banner', '-encoders'])
    if (!/\blibx264\b/.test(encoders)) throw new Error('libx264 encoder is required')
    const filters = run(ffmpeg, ['-hide_banner', '-filters'])
    for (const name of ['scale', 'pad', 'hstack', 'drawtext', 'trim', 'setpts', 'fps', 'format', 'crop', 'concat']) {
      if (!new RegExp(`\\b${name}\\b`).test(filters)) throw new Error(`${name} filter is required`)
    }
    run(ffprobe, ['-version'])
    // Test the actual filter/codec/font combination, not just capability names.
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=16x16:duration=0.1', '-vf', "drawtext=text='Prueba':fontsize=10", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'null', '-'])
    return { ffmpeg, ffprobe }
  } catch (error) {
    throw new Error(`FFmpeg and FFprobe with libx264 and drawtext are required. Supply existing binaries with FFMPEG_PATH=/absolute/ffmpeg FFPROBE_PATH=/absolute/ffprobe pnpm demo:queue:order. No tools were installed. Cause: ${error.message}`)
  }
}
export function markerEnd(bytes, fps = 25) {
  let last = -1
  for (let i = 0; i < bytes.length; i += 3) {
    if (bytes[i] > 200 && bytes[i + 1] < 60 && bytes[i + 2] > 200) last = i / 3
  }
  if (last < 0 || last >= bytes.length / 3 - 1) throw new Error('Missing or incomplete calibration marker')
  return (last + 1) / fps
}
export function selectServices(args) {
  if (args.length > 1) throw new Error('Supply one service: restaurant, reception, pool, or all')
  const choice = args[0] ?? 'reception'
  if (choice === 'all') return ['restaurant', 'reception', 'pool']
  if (choice === 'order') return ['reception']
  if (!['restaurant', 'reception', 'pool'].includes(choice)) throw new Error(`Unknown service: ${choice}`)
  return [choice]
}
export function assertStableSource(before, after) {
  if (before.sha256 !== after.sha256) throw new Error('Source changed during recording or composition; refusing finalization')
}
export function calibratedOffset(markerSeconds, afterMarker) {
  if (![markerSeconds, afterMarker].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid calibration offsets')
  return markerSeconds + afterMarker
}
function segments(chapter) {
  let start = 0
  const result = []
  for (const cut of chapter.cuts) { result.push([start, cut.start]); start = cut.end }
  result.push([start, chapter.duration])
  return result
}
export function outputDuration(e) {
  return e.chapters.reduce((sum, c) => sum + segments(c).reduce((n, [a, b]) => n + b - a, 0), 0)
}
function editorialTime(chapter, at) {
  return at - chapter.cuts.reduce((sum, cut) => sum + Math.max(0, Math.min(at, cut.end) - cut.start), 0)
}
// Measure the continuous visible hold before the next caption, chapter end, or cut.
// The recorded hold is a requested timer duration, not an exact clock guarantee.
function retainedHold(chapter, moment, index) {
  let end = Math.min(moment.at + moment.hold, chapter.moments[index + 1]?.at ?? chapter.duration, chapter.duration)
  for (const cut of chapter.cuts) {
    if (cut.start <= moment.at && cut.end > moment.at) return 0
    if (cut.start > moment.at) end = Math.min(end, cut.start)
  }
  return end - moment.at
}
export function validateEvidence(e) {
  if (e.status !== 'passed' || !['restaurant', 'reception', 'pool'].includes(e.type)) throw new Error('Scenario must pass with a known service')
  if (JSON.stringify(e.chapters?.map(c => c.id)) !== '["main","alternatives","expiration"]') throw new Error('Three independent ordered chapters required')
  if (new Set(e.chapters.map(c => c.fixture?.queueId)).size !== 3 || new Set(e.chapters.map(c => c.fixture?.venueId)).size !== 3 || e.chapters.some(c => !c.fixture?.queueId || !c.fixture?.venueId)) throw new Error('Chapters require independent fixture identities')
  if (e.chapters.some(c => c.fixture.graceMinutes !== (c.id === 'expiration' ? 1 : e.type === 'restaurant' ? 5 : 2))) throw new Error('Incorrect chapter grace configuration')
  const assertions = [...(e.assertions ?? []), ...e.chapters.flatMap(c => c.assertions ?? [])]
  if (!assertions.length || assertions.some(a => !a.key || a.actual === undefined || a.expected === undefined || JSON.stringify(a.actual) !== JSON.stringify(a.expected))) throw new Error('Unverified actual/expected assertion')
  if (assertions.some(a => a.key.startsWith('phase:') && (a.actual !== a.key.slice(6) || a.expected !== a.key.slice(6)))) throw new Error('Unverified phase value')
  const required = ['waiting', 'approaching', 'called', 'arrived', 'cancelled', 'expired'].map(p => `phase:${p}`)
  required.push('discovery', 'form', 'yield', 'cancel', 'deadline')
  if (e.type === 'restaurant') required.push('edit:party', 'edit:space', 'resource:released')
  if (required.some(key => !assertions.some(a => a.key === key))) throw new Error('Missing service coverage')
  for (const c of e.chapters) {
    if (!Number.isFinite(c.duration) || c.duration < 10) throw new Error('Invalid chapter duration')
    if (JSON.stringify(c.videos?.map(v => v.role)) !== '["staff","customer"]' || c.videos.some(v => !v.path || !Number.isFinite(v.offset) || v.offset < 0)) throw new Error('Missing independently aligned two-role recordings')
    let end = 0
    for (const cut of c.cuts ?? []) {
      if (c.id !== 'expiration' || !Number.isFinite(cut.start) || !Number.isFinite(cut.end) || cut.start < end || cut.end <= cut.start || cut.end >= c.duration || !cut.label) throw new Error('Invalid idle cut')
      end = cut.end
    }
    if (!c.moments?.length || c.moments.some((m, i) =>
      !m.event || !m.caption || !Number.isFinite(m.at) || !Number.isFinite(m.hold) ||
      m.at < 0 || m.at + m.hold > c.duration + .1 || m.hold < 5 ||
      (i > 0 && m.at < c.moments[i - 1].at) || retainedHold(c, m, i) < 5
    )) throw new Error('Invalid confirmed moment or removed five-second hold')
  }
}
const escapeText = text => text.replaceAll('\\', '\\\\').replaceAll("'", '’').replaceAll(':', '\\:').replaceAll('%', '\\%')
export function composition(e) {
  validateEvidence(e)
  const filters = [], videos = e.chapters.flatMap(c => c.videos)
  for (let ci = 0; ci < e.chapters.length; ci++) {
    const c = e.chapters[ci], spans = segments(c)
    for (let role = 0; role < 2; role++) {
      const input = ci * 2 + role, branches = spans.map((_, k) => `b${ci}_${role}_${k}`)
      if (spans.length > 1) filters.push(`[${input}:v]split=${spans.length}${branches.map(b => `[${b}]`).join('')}`)
      spans.forEach(([a, b], k) => {
        const label = spans.length > 1 ? branches[k] : `${input}:v`
        filters.push(`[${label}]trim=start=${c.videos[role].offset + a}:end=${c.videos[role].offset + b},setpts=PTS-STARTPTS,fps=25,scale=390:844,setsar=1[p${ci}_${role}_${k}]`)
      })
      filters.push(`${spans.map((_, k) => `[p${ci}_${role}_${k}]`).join('')}concat=n=${spans.length}:v=1:a=0,pad=960:1080:285:118:color=0x101827[s${ci}_${role}]`)
    }
    let caption = `[s${ci}_0][s${ci}_1]hstack=inputs=2,drawtext=text='PERSONAL':fontcolor=white:fontsize=30:x=400:y=50,drawtext=text='CLIENTE':fontcolor=white:fontsize=30:x=1340:y=50`
    const duration = spans.reduce((sum, [a, b]) => sum + b - a, 0)
    for (let i = 0; i < c.moments.length; i++) {
      const m = c.moments[i], start = editorialTime(c, m.at), end = editorialTime(c, c.moments[i + 1]?.at ?? c.duration)
      caption += `,drawtext=text='${escapeText(m.caption)}':fontcolor=white:fontsize=25:x=(w-tw)/2:y=997:enable='between(t,${start},${end})'`
    }
    for (const cut of c.cuts) {
      const start = editorialTime(c, cut.end)
      caption += `,drawtext=text='${escapeText(cut.label)}':fontcolor=0xfbbf24:fontsize=22:x=(w-tw)/2:y=84:enable='between(t,${start},${Math.min(duration, start + 6)})'`
    }
    caption += ",drawtext=text='Simulación local con datos ficticios · Sin mensajes reales':fontcolor=0xadb7c9:fontsize=21:x=(w-tw)/2:y=1045"
    filters.push(`${caption}[chapter${ci}]`)
  }
  filters.push('[chapter0][chapter1][chapter2]concat=n=3:v=1:a=0,format=yuv420p[out]')
  return ['-y', ...videos.flatMap(v => ['-i', v.path]), '-filter_complex', filters.join(';'), '-map', '[out]', '-an', '-r', '25', '-t', String(outputDuration(e)), '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
}
