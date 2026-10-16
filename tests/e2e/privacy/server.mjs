import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const web = createRequire(path.join(root, 'apps/web/package.json'))
const { build } = createRequire(path.join(root, 'apps/landing/package.json'))('esbuild')
const assets = new Map()
for (const environment of ['production', 'staging']) {
  const result = await build({ entryPoints: [fileURLToPath(new URL('./fixture.tsx', import.meta.url))], bundle: true, write: false, outdir: '/virtual', format: 'esm',
    alias: { react: path.dirname(web.resolve('react/package.json')), 'react-dom': path.dirname(web.resolve('react-dom/package.json')), 'react-router': web.resolve('react-router'), '@': path.join(root, 'apps/web/src') },
    define: { 'import.meta.env.VITE_APP_ENV': JSON.stringify(environment), 'import.meta.env.VITE_ANALYTICS_ENABLED': '"true"', 'import.meta.env.VITE_GA4_MEASUREMENT_ID': '"G-TEST12345"', 'import.meta.hot': 'undefined', 'process.env.NODE_ENV': '"production"' },
  })
  for (const file of result.outputFiles) assets.set(`/${environment}/fixture${path.extname(file.path)}`, file.text)
}
// Exercise the actual static landing entry without overwriting its deployable dist.
const { readFile } = await import('node:fs/promises')
const landing = await build({ entryPoints: [path.join(root, 'apps/landing/scripts/privacy-entry.ts')], outfile: '/virtual/privacy.js', bundle: true, write: false, format: 'esm', define: { __PRIVACY_CONFIG__: JSON.stringify({ environment: 'production', enabled: true, measurementId: 'G-LANDING123' }) } })
for (const file of landing.outputFiles) assets.set('/landing/' + path.basename(file.path), file.text)
for (const name of ['index.html', 'preferences.js', 'styles.css', 'favicon.svg']) assets.set('/landing/' + name, await readFile(path.join(root, 'apps/landing/src', name)))
createServer((req, res) => {
  const key = req.url?.split('?')[0], body = assets.get(key)
  if (!body) { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', key.endsWith('.js') ? 'text/javascript' : key.endsWith('.css') ? 'text/css' : key.endsWith('.svg') ? 'image/svg+xml' : 'text/html')
  res.end(body)
}).listen(Number(process.env.NOQUEUE_PRIVACY_PORT), '127.0.0.1')
