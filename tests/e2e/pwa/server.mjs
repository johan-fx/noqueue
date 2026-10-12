import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  access,
  cp,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const port = Number(process.env.NOQUEUE_PWA_PORT ?? 8791)
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'noqueue-pwa-e2e-'))
const builds = { a: path.join(tempRoot, 'build-a'), b: path.join(tempRoot, 'build-b') }

function buildProduction(outDir) {
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@noqueue/web',
      'exec',
      'vite',
      'build',
      '--outDir',
      outDir,
      '--emptyOutDir',
    ],
    { cwd: repoRoot, stdio: 'inherit', env: process.env },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Vite build failed (${result.status})`)
}

function withBuildMarker(html, build) {
  return html.replace(/<html\b([^>]*)>/i, (_tag, attributes) => {
    const cleaned = attributes.replace(/\sdata-pwa-e2e-build="[^"]*"/i, '')
    return `<html${cleaned} data-pwa-e2e-build="${build}">`
  })
}

async function prepareBuilds() {
  buildProduction(builds.a)
  await cp(builds.a, builds.b, { recursive: true })

  // Model a real hashed production release: every lazy/imported module in B
  // gets a new URL, and every reference in the module graph/precache is updated.
  const assetsDir = path.join(builds.b, 'assets')
  const assetEntries = await readdir(assetsDir, { withFileTypes: true })
  const bundleNames = assetEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
  const renamedBundles = new Map(
    bundleNames.map((name) => [name, `${name.slice(0, -3)}-b.js`]),
  )
  for (const [oldName, newName] of renamedBundles) {
    await rename(path.join(assetsDir, oldName), path.join(assetsDir, newName))
  }

  async function rewriteTextFiles(directory) {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const filePath = path.join(directory, child.name)
      if (child.isDirectory()) {
        await rewriteTextFiles(filePath)
      } else if (/\.(?:css|html|js|json|map|svg|webmanifest)$/.test(child.name)) {
        let contents = await readFile(filePath, 'utf8')
        for (const [oldName, newName] of renamedBundles) {
          contents = contents.replaceAll(oldName, newName)
        }
        await writeFile(filePath, contents)
      }
    }
  }
  await rewriteTextFiles(builds.b)

  for (const build of ['a', 'b']) {
    const indexPath = path.join(builds[build], 'index.html')
    const html = withBuildMarker(await readFile(indexPath, 'utf8'), build)
    await writeFile(indexPath, html)

    // Workbox uses a revision URL for the app shell. Keep the test marker and
    // the precache revision in sync so the new worker installs build B's HTML.
    const revision = createHash('md5').update(html).digest('hex')
    const workerPath = path.join(builds[build], 'sw.js')
    let worker = await readFile(workerPath, 'utf8')
    const indexEntry = /(url:["']index\.html["'],revision:["'])[^"']+(["'])/
    if (!indexEntry.test(worker)) {
      throw new Error('Could not find index.html in generated Workbox precache')
    }
    worker = worker.replace(indexEntry, `$1${revision}$2`)
    if (build === 'b') worker += '\n/* pwa-e2e-build-b */\n'
    await writeFile(workerPath, worker)
  }
}

await prepareBuilds()

let activeBuild = 'a'
let missingPublicQueueChunk = false
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

async function serveFile(response, pathname) {
  const root = builds[activeBuild]
  const relative = decodeURIComponent(pathname.replace(/^\/+/, ''))
  const filePath = path.resolve(root, relative || 'index.html')
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, 'index.html')) {
    send(response, 400, 'Invalid path')
    return
  }

  if (
    missingPublicQueueChunk &&
    /^\/assets\/PublicQueue-[^/]+\.js$/.test(pathname)
  ) {
    send(response, 404, 'Public queue module not found')
    return
  }

  try {
    await access(filePath)
    const body = await readFile(filePath)
    const headers = {
      'Content-Type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    }
    if (pathname === '/sw.js' || pathname === '/registerSW.js' || pathname === '/index.html') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    } else {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    }
    response.writeHead(200, headers)
    response.end(body)
  } catch {
    // Missing bundles must never receive the SPA HTML fallback. This mirrors
    // the desired production static-asset behavior while preserving SPA routes.
    if (pathname.startsWith('/assets/')) {
      send(response, 404, 'Asset not found')
      return
    }
    if (path.extname(pathname)) {
      send(response, 404, 'File not found')
      return
    }
    try {
      const index = await readFile(path.join(root, 'index.html'))
      response.writeHead(200, {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(index)
    } catch (error) {
      send(response, 500, String(error))
    }
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  if (url.pathname === '/__pwa_test__/version') {
    send(response, 200, JSON.stringify({ build: activeBuild, missingPublicQueueChunk }), 'application/json')
    return
  }
  if (url.pathname === '/__pwa_test__/assets') {
    const build = url.searchParams.get('build')
    if (build !== 'a' && build !== 'b') {
      send(response, 400, 'build must be a or b')
      return
    }
    const names = await readdir(path.join(builds[build], 'assets'))
    send(
      response,
      200,
      JSON.stringify(names.filter((name) => name.endsWith('.js'))),
      'application/json',
    )
    return
  }
  if (url.pathname === '/__pwa_test__/switch' && request.method === 'POST') {
    let body = ''
    for await (const chunk of request) body += chunk
    const { build } = JSON.parse(body || '{}')
    if (build !== 'a' && build !== 'b') {
      send(response, 400, 'build must be a or b')
      return
    }
    activeBuild = build
    missingPublicQueueChunk = false
    send(response, 200, JSON.stringify({ build }), 'application/json')
    return
  }
  if (url.pathname === '/__pwa_test__/missing-public-queue' && request.method === 'POST') {
    missingPublicQueueChunk = true
    send(response, 200, JSON.stringify({ missingPublicQueueChunk }), 'application/json')
    return
  }
  if (url.pathname === '/__pwa_test__/reset' && request.method === 'POST') {
    activeBuild = 'a'
    missingPublicQueueChunk = false
    send(response, 200, JSON.stringify({ build: activeBuild }), 'application/json')
    return
  }
  await serveFile(response, url.pathname)
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`PWA production-build harness ready at http://127.0.0.1:${port}\n`)
})

async function cleanup() {
  server.close()
  await rm(tempRoot, { recursive: true, force: true })
}
process.once('SIGINT', () => void cleanup().finally(() => process.exit(0)))
process.once('SIGTERM', () => void cleanup().finally(() => process.exit(0)))
