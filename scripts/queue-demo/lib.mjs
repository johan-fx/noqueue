import { execFileSync } from 'node:child_process'

export function preflight(run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), env = process.env) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg', ffprobe = env.FFPROBE_PATH || 'ffprobe'
  try {
    const encoders = run(ffmpeg, ['-hide_banner', '-encoders'])
    if (!/\blibx264\b/.test(encoders)) throw new Error('libx264 encoder is required')
    const filters = run(ffmpeg, ['-hide_banner', '-filters'])
    for (const name of ['scale', 'pad', 'hstack', 'drawtext', 'trim', 'setpts', 'fps', 'format', 'crop']) {
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
export function validateEvidence(e) {
  if (e.status !== 'passed' || !Number.isFinite(e.duration) || e.duration < 60 || e.duration > 90) throw new Error('Scenario must pass and last 60–90 seconds')
  if (JSON.stringify(e.assertions?.actual) !== '["Bob","Alice"]' || JSON.stringify(e.assertions?.expected) !== '["Bob","Alice"]' || e.assertions.alice !== 2 || e.assertions.bob !== 1) throw new Error('Missing verified queue assertions')
  if (e.videos?.length !== 2 || e.videos.some(v => !v.path || !Number.isFinite(v.offset) || v.offset < 0)) throw new Error('Missing aligned recordings')
  if (!e.moments?.length || e.moments.some(m => !Number.isFinite(m.at) || m.at < 0 || m.at > e.duration)) throw new Error('Invalid scenario timeline')
}
const captions = {
  intro: 'Personal a la izquierda · Cliente Alice a la derecha',
  'alice-joined': 'Alice se une desde su móvil y ocupa la posición 1',
  'both-joined': 'Bob entra desde otro móvil · Alice 1 · Bob 2',
  'before-action': 'El personal elige Pasar al final para Alice y confirma',
  'confirm-action': 'El personal confirma la acción',
  result: 'Resultado verificado · Bob 1 · Alice 2 · Todos ven el mismo orden',
}
export function composition(e) {
  validateEvidence(e)
  const streams = e.videos.map((v, i) => `[${i}:v]trim=start=${v.offset}:duration=${e.duration},setpts=PTS-STARTPTS,fps=25,scale=390:844,pad=960:1080:285:118:color=0x101827[s${i}]`)
  let filter = `${streams.join(';')};[s0][s1]hstack=inputs=2,drawtext=text='PERSONAL':fontcolor=white:fontsize=30:x=400:y=50,drawtext=text='CLIENTE · ALICE':fontcolor=white:fontsize=30:x=1300:y=50`
  for (let i = 0; i < e.moments.length; i++) {
    const m = e.moments[i], text = captions[m.event]
    if (!text) throw new Error(`Unknown caption: ${m.event}`)
    filter += `,drawtext=text='${text}':fontcolor=white:fontsize=30:x=(w-tw)/2:y=1000:enable='between(t,${m.at},${e.moments[i + 1]?.at ?? e.duration})'`
  }
  filter += ",drawtext=text='Simulación local con datos ficticios · Sin mensajes reales':fontcolor=0xadb7c9:fontsize=21:x=(w-tw)/2:y=1045[out]"
  return ['-y', ...e.videos.flatMap(v => ['-i', v.path]), '-filter_complex', filter, '-map', '[out]', '-an', '-t', String(e.duration), '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
}
