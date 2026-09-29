import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { preflight, composition, validateEvidence, markerEnd } from './lib.mjs'

test('preflight rejects missing tools and unsupported builds without installing', () => {
  assert.throws(() => preflight(() => { throw new Error('ENOENT') }), /FFmpeg.*FFprobe/)
  assert.throws(() => preflight(() => ''), /libx264/)
})
test('preflight checks encoder, filters, probe and explicit paths', () => {
  const calls = []
  preflight((bin, args) => { calls.push([bin,args]); return 'libx264 scale pad hstack drawtext trim setpts fps format crop'; }, { FFMPEG_PATH: '/local/ffmpeg', FFPROBE_PATH: '/local/ffprobe' })
  assert.equal(calls[0][0], '/local/ffmpeg')
  assert.equal(calls[2][0], '/local/ffprobe')
})
const evidence = { status: 'passed', duration: 65, videos: [{ path:'staff.webm', offset:4 }, { path:'alice.webm', offset:2 }], moments: [{ event:'intro', at:0 }, { event:'result', at:50 }], assertions: { actual:['Bob','Alice'], expected:['Bob','Alice'], alice:2, bob:1 } }
test('composition preserves real-time playback, trims setup and renders captions outside mobile viewports', () => {
  const args = composition(evidence)
  const filter = args[args.indexOf('-filter_complex') + 1]
  assert.match(filter, /trim=start=4:duration=65/)
  assert.match(filter, /trim=start=2:duration=65/)
  assert.match(filter, /pad=960:1080:285:118/)
  assert.match(filter, /y=1000/)
  assert.match(filter, /setpts=PTS-STARTPTS/)
  assert.ok(args.includes('-an'))
  assert.ok(!filter.includes('setpts=0.'))
})
test('failed, incomplete or excessively long scenario cannot produce success MP4', () => {
  for (const bad of [{...evidence,status:'failed'}, {...evidence,duration:91}, {...evidence,assertions:{ actual:['Alice','Bob'] }}, {...evidence,videos:[]}]) assert.throws(() => validateEvidence(bad))
})
test('calibration requires a visible marker followed by real frames', () => {
  assert.equal(markerEnd(Buffer.from([255,0,255, 255,0,255, 0,0,0]), 25), .08)
  assert.throws(() => markerEnd(Buffer.from([0,0,0]),25), /marker/)
  assert.throws(() => markerEnd(Buffer.from([255,0,255]),25), /marker/)
})
test('demo is opt-in and custom contexts explicitly inherit mobile recording options', () => {
  const config = readFileSync('tests/e2e/demo.config.ts','utf8')
  const flow = readFileSync('tests/e2e/helpers/queue-order.ts','utf8')
  assert.match(config, /testDir: '.\/demo'/)
  assert.match(config, /retries: 0/)
  assert.doesNotMatch(config, /defineConfig\(base,/, 'Playwright merges inherited project arrays by name')
  assert.match(flow, /\.\.\.options.contextOptions/)
  assert.match(flow, /finally/)
})

test('runner missing dependency exits before Playwright and produces no success announcement', async () => {
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(process.execPath, ['scripts/queue-demo/run.mjs'], {
    encoding: 'utf8', env: { ...process.env, FFMPEG_PATH: '/nonexistent/queue-demo/ffmpeg', FFPROBE_PATH: '/nonexistent/queue-demo/ffprobe' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /No tools were installed/)
  assert.doesNotMatch(result.stdout, /Running .*test|Verified local demo/)
})
