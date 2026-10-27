import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import './build.mjs';

const source = new URL('../dist/', import.meta.url);
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
    assert.equal([...html.matchAll(/<script\b/g)].length, 2);
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (href.startsWith('#')) {
        assert.ok(html.includes(`id="${href.slice(1)}"`));
      } else if (href.startsWith('/') && !href.startsWith('//')) {
        if (href !== '/') await read(href === '/privacy/' ? 'privacy/index.html' : href.slice(1));
      } else {
        assert.ok(['https://noqueue-app.com/', 'mailto:hola@noqueue-app.com', 'tel:+34971682500'].includes(href), `Unexpected URL: ${href}`);
      }
    }
  }
  assert.doesNotMatch(await read('styles.css'), /@import|https?:\/\//i);
  assert.deepEqual((await readdir(source)).sort(), ['404.html', '_headers', 'cookieconsent.LICENSE.txt', 'favicon.svg', 'googlebc43045699d02e9c.html', 'index.html', 'preferences.js', 'privacy', 'privacy.css', 'privacy.js', 'robots.txt', 'styles.css']);
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


test('serves consent locally and publishes bilingual legal copy without inline scripts or Google hints', async () => {
  for (const name of ['index.html', '404.html', 'privacy/index.html']) {
    const html = await read(name);
    assert.match(html, /src="\/privacy.js"/);
    assert.match(html, /data-privacy-settings/);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.doesNotMatch(html, /preconnect|dns-prefetch|googletagmanager|<script[^>]*>[^<]+/);
  }
  const legal = await read('privacy/index.html');
  assert.match(legal, /13 meses/);
  assert.match(legal, /data-en=/);
  assert.ok((await read('privacy.css')).includes('#cc-main'));
});


test('keeps the self-hosted consent entry lightweight', async () => {
  assert.ok(gzipSync(await read('privacy.js')).byteLength < 20000, 'Do not bundle the server schema/locale catalogue into the landing');
});

test('publishes mobile privacy and a prominent bilingual deletion procedure', async () => {
  const html = await read('privacy/index.html');
  assert.match(html, /rel="canonical" href="https:\/\/noqueue-app.com\/privacy\/"/);
  assert.match(html, /href="#delete-data" data-en="How to request deletion of your data"/);
  assert.match(html, /<section id="delete-data">/);
  assert.match(html, /href="mailto:hola@noqueue-app.com\?subject=/);
  for (const text of ['iOS y Android', 'iOS and Android', 'Firebase Cloud Messaging', 'Apple Push Notification service', 'Cloudflare', 'WhatsApp/Meta', 'aproximada o precisa', 'approximate or precise', 'no subimos sus imágenes', 'do not upload camera images', 'No necesitas una cuenta', 'You do not need an account', 'plazo de un mes', 'within one month', 'No existe un borrado automático general', 'no general automatic deletion', 'copias de seguridad', 'Backups', 'versión documental 2', 'document version 2']) {
    assert.ok(html.includes(text), `Missing mobile privacy statement: ${text}`);
  }
  assert.doesNotMatch(html, /analítica permanece desactivada|Analytics remains disabled/);
  assert.equal([...html.matchAll(/<section id=/g)].length, 16);
  // An informational notice update must not silently invalidate analytics consent.
  const contract = await readFile(new URL('../../../packages/contracts/src/privacy-policy.ts', import.meta.url), 'utf8');
  assert.match(contract, /PRIVACY_REVISION\s*=\s*1/);
});
