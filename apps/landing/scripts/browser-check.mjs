// Uses the repository's existing browser tooling; no landing runtime dependency.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../tests/e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const baseURL = process.env.LANDING_URL ?? 'http://127.0.0.1:8788';
const screenshotDirectory = process.env.LANDING_SCREENSHOTS;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  for (const width of [320, 390, 1440]) {
    for (const language of ['es', 'en']) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
        const page = await context.newPage();
        const errors = []; const requests = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => requests.push(request.url()));
        await page.goto(baseURL);
        await page.locator('#language').selectOption(language);
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.ok(await page.getByRole('combobox', { name: language === 'en' ? 'Language' : 'Idioma', exact: true }).isVisible());
        const toggle = page.getByRole('switch', { name: language === 'en' ? 'Dark mode' : 'Modo oscuro', exact: true });
        assert.equal(await toggle.getAttribute('aria-checked'), String(theme === 'dark'));
        assert.ok(await page.locator('html').evaluate((element) => element.scrollWidth <= innerWidth), `Overflow: ${width}/${language}/${theme}`);
        if (language === 'en') {
          assert.match(await page.title(), /More freedom/);
          assert.equal(await page.locator('meta[property="og:locale"]').getAttribute('content'), 'en_GB');
          assert.equal(await page.locator('[data-en]').evaluateAll((elements) => elements.every((element) => element.innerHTML === element.dataset.en)), true);
        }
        if (screenshotDirectory && language === 'en' && theme === 'dark' && width !== 320) {
          await page.screenshot({ path: `${screenshotDirectory}/noqueue-landing-en-dark-${width}.png`, fullPage: true });
        }
        await toggle.focus(); await page.keyboard.press('Space');
        assert.equal(await toggle.getAttribute('aria-checked'), String(theme !== 'dark'));
        await page.reload();
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme === 'dark' ? 'light' : 'dark');
        const missing = await page.goto(`${baseURL}/missing`);
        assert.equal(missing.status(), 404);
        assert.match(await page.title(), language === 'en' ? /Page not found/ : /Página no encontrada/);
        assert.ok((await page.locator('h1').innerText()).includes(language === 'en' ? 'Page not found.' : 'Página no encontrada.'));
        assert.deepEqual(errors, []);
        assert.ok(requests.every((url) => url.startsWith(baseURL + '/')));
        await context.close(); checks++;
      }
    }
  }
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(baseURL);
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).focus();
  // Native select typeahead is portable to headless macOS (arrow keys open the OS picker).
  await page.keyboard.press('e');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('switch').press('Enter');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await context.close(); checks++;

  const blockedContext = await browser.newContext({ colorScheme: 'dark' });
  await blockedContext.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  const blockedPage = await blockedContext.newPage();
  const blockedErrors = [];
  blockedPage.on('pageerror', (error) => blockedErrors.push(error.message));
  await blockedPage.goto(baseURL);
  await blockedPage.locator('#language').selectOption('en');
  await blockedPage.getByRole('switch', { name: 'Dark mode', exact: true }).press('Space');
  assert.equal(await blockedPage.locator('html').getAttribute('lang'), 'en');
  assert.equal(await blockedPage.locator('html').getAttribute('data-theme'), 'light');
  await blockedPage.reload();
  assert.equal(await blockedPage.locator('html').getAttribute('lang'), 'es');
  assert.equal(await blockedPage.locator('html').getAttribute('data-theme'), 'dark');
  assert.deepEqual(blockedErrors, []);
  await blockedContext.close(); checks++;

  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noJS.newPage();
  await staticPage.goto(baseURL);
  assert.ok(await staticPage.getByText('LUMOSA S.A.', { exact: true }).isVisible());
  assert.ok(await staticPage.locator('footer a[href="mailto:hola@noqueue-app.com"]').isVisible());
  assert.equal(await staticPage.locator('html').getAttribute('lang'), 'es');
  assert.ok(await staticPage.locator('.preferences').isHidden());
  await noJS.close(); checks++;
  console.log(`Passed ${checks} browser scenarios: viewport/locale/theme matrix, reload, 404, keyboard, system theme, blocked storage, no-JS legal content.`);
} finally {
  await browser.close();
}
