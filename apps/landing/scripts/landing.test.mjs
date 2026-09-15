import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const source = new URL('../src/', import.meta.url);
const read = (name) => readFile(new URL(name, source), 'utf8');

test('identifies the owner and public contact without promising availability', async () => {
  const html = await read('index.html');
  for (const text of ['LUMOSA S.A.', 'Avda Cas Saboners Nº8', '07181', 'Calviá - Illes Balears', 'A07207848', 'tel:+34971682500', 'mailto:hola@noqueue-app.com', 'en desarrollo', 'no está disponible', 'consentimiento']) {
    assert.ok(html.includes(text), `Missing required information: ${text}`);
  }
  assert.match(html, /<html lang="es">/);
  assert.match(html, /rel="canonical" href="https:\/\/noqueue-app.com\/"/);
});

test('publishes only local static assets, contact links and page anchors', async () => {
  for (const name of ['index.html', '404.html']) {
    const html = await read(name);
    assert.doesNotMatch(html, /<(iframe|form)\b/i);
    assert.match(html, /<script src="\/preferences.js" defer><\/script>/);
    assert.equal([...html.matchAll(/<script\b/g)].length, 1);
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (href.startsWith('#')) {
        assert.ok(html.includes(`id="${href.slice(1)}"`));
      } else if (href.startsWith('/') && !href.startsWith('//')) {
        if (href !== '/') await read(href.slice(1));
      } else {
        assert.ok(['https://noqueue-app.com/', 'mailto:hola@noqueue-app.com', 'tel:+34971682500'].includes(href), `Unexpected URL: ${href}`);
      }
    }
  }
  assert.doesNotMatch(await read('styles.css'), /@import|https?:\/\//i);
  assert.deepEqual((await readdir(source)).sort(), ['404.html', '_headers', 'favicon.svg', 'index.html', 'preferences.js', 'robots.txt', 'styles.css']);
});

test('isolates deployment from the pilot and rejects unknown routes with 404', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['$schema', 'account_id', 'assets', 'compatibility_date', 'name', 'preview_urls', 'routes', 'workers_dev']);
  assert.deepEqual(config.assets, { directory: './dist', html_handling: 'auto-trailing-slash', not_found_handling: '404-page' });
  assert.deepEqual(config.routes, [{ pattern: 'noqueue-app.com', custom_domain: true }]);
  assert.equal(config.account_id, 'fa5fab4df1b0f12c946a3ea47fab96eb');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.match(await read('_headers'), /default-src 'none'/);
  assert.match(await read('_headers'), /script-src 'self'/);
  assert.doesNotMatch(await read('_headers'), /unsafe-inline/);
});
