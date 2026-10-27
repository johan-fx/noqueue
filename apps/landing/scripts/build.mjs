import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await cp(new URL('../src/', import.meta.url), output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('./privacy-entry.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('privacy.js', output)), bundle: true, minify: true, format: 'esm',
  define: { __PRIVACY_CONFIG__: JSON.stringify({ environment: process.env.LANDING_APP_ENV ?? '', enabled: process.env.LANDING_ANALYTICS_ENABLED === 'true', measurementId: process.env.LANDING_GA4_MEASUREMENT_ID ?? '' }) },
});
// Build the bilingual legal page from the same versioned copy used by React.
const legal = await build({ entryPoints: [fileURLToPath(new URL('../../../packages/privacy/src/legal.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { legalCopy, legalSectionIds } = await import('data:text/javascript;base64,' + Buffer.from(legal.outputFiles[0].text).toString('base64'));
const esc = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
let html = await readFile(new URL('../src/404.html', import.meta.url), 'utf8');
html = html.replace(/<meta name="robots"[^>]*>/, '').replace(/<title[^>]*>.*?<\/title>/, `<title data-en="${esc(legalCopy.en.title)}">${esc(legalCopy.es.title)}</title>`);
html = html.replace('</head>', '<link rel="canonical" href="https://noqueue-app.com/privacy/">\n</head>');
const deletionLink = '<p><a href="mailto:hola@noqueue-app.com?subject=NoQueue%20-%20Data%20deletion%20%2F%20Eliminaci%C3%B3n%20de%20datos" data-en="Request data deletion by email">Solicitar la eliminación por correo</a></p>';
html = html.replace(/<main[\s\S]*?<\/main>/, `<main class="nq-privacy-legal"><h1 data-en="${esc(legalCopy.en.title)}">${esc(legalCopy.es.title)}</h1><p><a href="#delete-data" data-en="How to request deletion of your data">Cómo solicitar la eliminación de tus datos</a></p>${legalCopy.es.sections.map(([title, body], i) => `<section id="${legalSectionIds[i]}"><h2 data-en="${esc(legalCopy.en.sections[i][0])}">${esc(title)}</h2><p data-en="${esc(legalCopy.en.sections[i][1])}">${esc(body)}</p>${legalSectionIds[i] === 'delete-data' ? deletionLink : ''}</section>`).join('')}<p><a href="https://policies.google.com/privacy" rel="noreferrer">Google Privacy</a> · <a href="https://www.aepd.es/" rel="noreferrer">AEPD</a></p></main>`);
await mkdir(new URL('privacy/', output), { recursive: true });
await writeFile(new URL('privacy/index.html', output), html);
console.log('Built static landing and self-hosted privacy assets in apps/landing/dist');
