import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflight, markerEnd, composition } from './lib.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
process.chdir(root)
process.umask(0o077)
const command = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
function snapshot() {
  const files = command('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean).sort()
  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(file + '\0')
    try { digest.update(String(lstatSync(file).mode)); digest.update(readFileSync(file)) }
    catch (error) { if (error.code !== 'ENOENT') throw error; digest.update('deleted') }
  }
  return { head: command('git', ['rev-parse', 'HEAD']).trim(), dirty: Boolean(command('git', ['status', '--porcelain']).trim()), sha256: digest.digest('hex') }
}
let output
try {
  // Before creating a server or recording: never download or install dependencies.
  const bins = preflight()
  output = path.join(root, 'queue-demo-output', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const source = snapshot()
  writeFileSync(path.join(output, 'source.json'), JSON.stringify(source, null, 2))
  const result = spawnSync('pnpm', ['--filter', '@noqueue/e2e', 'exec', 'playwright', 'test', '--config=demo.config.ts', '--workers=1', '--retries=0'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, QUEUE_DEMO_DIR: output },
  })
  if (result.error || result.status !== 0) throw new Error('Recorded scenario failed; diagnostics retained, no success MP4 created')
  if (source.sha256 !== snapshot().sha256) throw new Error('Source changed during recording; refusing composition')
  const evidence = JSON.parse(readFileSync(path.join(output, 'scenario.json'), 'utf8'))
  if (evidence.status !== 'passed') throw new Error('Scenario did not pass')
  for (const video of evidence.videos) {
    // Sample the center pixel at the recording frame rate to find marker removal.
    const pixels = command(bins.ffmpeg, ['-v', 'error', '-i', video.path, '-vf', 'fps=25,crop=2:2:194:422,scale=1:1,format=rgb24', '-f', 'rawvideo', '-'], { encoding: null })
    video.offset = markerEnd(pixels) + video.afterMarker
    const probe = JSON.parse(command(bins.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', video.path]))
    const stream = probe.streams.find(s => s.codec_type === 'video')
    if (stream?.width !== 390 || stream?.height !== 844 || Number(probe.format.duration) < video.offset + evidence.duration - 0.15) throw new Error('Incomplete or incorrectly sized raw recording')
  }
  writeFileSync(path.join(output, 'moments.json'), JSON.stringify({ ...evidence, source, alignmentToleranceSeconds: 0.15 }, null, 2))
  const pending = path.join(output, 'pending.mp4')
  command(bins.ffmpeg, [...composition(evidence), pending])
  const probe = JSON.parse(command(bins.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', pending]))
  const video = probe.streams.find(s => s.codec_type === 'video')
  if (video?.width !== 1920 || video?.height !== 1080 || probe.streams.some(s => s.codec_type === 'audio') || Math.abs(Number(probe.format.duration) - evidence.duration) > 0.2) throw new Error('MP4 output validation failed')
  writeFileSync(path.join(output, 'probe.json'), JSON.stringify(probe, null, 2))
  const final = path.join(output, 'queue-order.mp4')
  renameSync(pending, final)
  console.log(`Verified local demo: ${final}\nReview the full video before sharing. Raw recordings and evidence remain private in ${output}`)
} catch (error) {
  if (output) writeFileSync(path.join(output, 'failure.txt'), error.message)
  console.error(error.message)
  process.exitCode = 1
}
