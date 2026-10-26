// Run against Chrome on a real Android/AVD, never a desktop device preset.
// See docs/development/android-input-audit.md for setup. Isolated local fixture only.
import { chromium, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const adbPath = process.env.ADB ?? `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`
const serial = process.env.ANDROID_SERIAL ?? 'emulator-5554'
const out = path.resolve('reports/android-inputs')
fs.mkdirSync(out, { recursive: true })
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { maxBuffer: 10 * 1024 * 1024 })
const dump = () => { adb('shell', 'uiautomator', 'dump', '/sdcard/noqueue-inputs.xml'); return adb('shell', 'cat', '/sdcard/noqueue-inputs.xml').toString() }
const screenshot = name => fs.writeFileSync(path.join(out, name), adb('exec-out', 'screencap', '-p'))
function tapNative(attribute, value) {
  const node = dump().match(/<node\b[^>]*>/g)?.find(n => n.includes(`${attribute}="${value}"`))
  assert.ok(node, `Missing native ${attribute}=${value}`)
  const [, x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  adb('shell', 'input', 'tap', String((+x1 + +x2) / 2), String((+y1 + +y2) / 2))
}
const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP ?? 'http://127.0.0.1:9223')
try {
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://127.0.0.1:5178/'))
  assert.ok(page, 'Open the isolated fixture in Chrome Android first')
  await page.goto('http://127.0.0.1:5178/')
  const userAgent = await page.evaluate(() => navigator.userAgent)
  assert.match(userAgent, /Android/)
  await page.evaluate(() => localStorage.removeItem('android-inputs-service'))
  await page.reload()
  const cdp = await page.context().newCDPSession(page)
  async function touch(locator) {
    await locator.waitFor({ state: 'visible' })
    await locator.click({ trial: true }) // Wait for drawer entry/scroll animation and hit testing.
    const box = await locator.boundingBox()
    assert.ok(box)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await touch(page.getByLabel('Hasta', { exact: true }))
  await expect.poll(() => dump(), { timeout: 10000 }).toMatch(/RadialTimePickerView/)
  // Emulator locale en-US: 23:00 is 11 PM. Change to 10:30 PM via native dial.
  tapNative('content-desc', '10')
  tapNative('content-desc', '30')
  tapNative('text', 'PM')
  tapNative('text', 'Set')
  await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('22:30')
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  assert.match(await page.getByRole('dialog').innerText(), /12:00 - 22:30/)
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  assert.equal(JSON.parse(await page.getByTestId('saved').innerText()).scheduleGroups[0].ranges[0].to, '22:30')
  await page.reload()
  await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('22:30')
  // A second real touch checks opening Desde and cancel-without-change.
  await touch(page.getByLabel('Desde', { exact: true }))
  await expect.poll(() => dump(), { timeout: 10000 }).toMatch(/RadialTimePickerView/)
  screenshot('after-picker.png')
  tapNative('text', 'Cancel')
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('12:00')
  screenshot('after-saved.png')
  // Empty numeric drafts: use Android key events, not DOM value injection.
  async function replaceNumber(locator, replacement) {
    if (!(await locator.evaluate(e => document.activeElement === e)) || !/mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method').toString())) await touch(locator)
    await locator.evaluate(e => e.select())
    adb('shell', 'input', 'keyevent', '67')
    await expect(locator).toHaveValue('')
    assert.match(adb('shell', 'dumpsys', 'input_method').toString(), /mInputShown=true/)
    screenshot('numeric-empty.png')
    if (replacement) {
      adb('shell', 'input', 'text', replacement)
      await expect(locator).toHaveValue(replacement)
    }
    adb('shell', 'input', 'keyevent', '4') // close IME before drawer navigation
  }
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  const capacity = page.getByLabel('Nº total de mesas disponibles')
  await replaceNumber(capacity, '')
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(capacity).toHaveValue('')
  await expect(page.getByText('Introduce un número válido')).toBeVisible()
  await replaceNumber(capacity, '12')
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(page.getByLabel('Nº máximo de turnos en lista')).toBeVisible()
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  assert.equal(JSON.parse(await page.getByTestId('saved').innerText()).spaces[0].tables, 12)

  console.log('PASS: schedule and numeric capacity')
  await page.goto('http://127.0.0.1:5178/?mode=queue')
  await page.getByRole('button', { name: 'Mesas de 4', exact: true }).click()
  const minutes = page.getByLabel('Interior · 4 plazas (min)')
  await replaceNumber(minutes, '')
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(minutes).toHaveValue('')
  assert.notEqual(JSON.parse(await page.getByTestId('saved').innerText()).spaces[0].tableTypes?.[0]?.averageMinutes, null)
  await replaceNumber(minutes, '45')
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect.poll(async () => JSON.parse(await page.getByTestId('saved').innerText()).spaces[0].tableTypes?.[0]?.averageMinutes).toBe(45)

  async function chooseTime(locator, hour, minute, value) {
    await touch(locator)
    await expect.poll(() => dump(), { timeout: 10000 }).toMatch(/RadialTimePickerView/)
    tapNative('content-desc', hour)
    tapNative('content-desc', minute)
    tapNative('text', 'PM')
    tapNative('text', 'Set')
    await expect(locator).toHaveValue(value)
  }
  console.log('PASS: numeric group minutes')
  await page.goto('http://127.0.0.1:5178/?mode=legacy')
  await chooseTime(page.getByLabel('Desde 1', { exact: true }), '1', '15', '13:15')
  await chooseTime(page.getByLabel('Hasta 1', { exact: true }), '10', '30', '22:30')
  await page.getByRole('button', { name: 'Añadir servicio', exact: true }).click()
  await expect.poll(async () => JSON.parse(await page.getByTestId('saved').innerText()).schedules?.[0]?.from).toBe('13:15')
  assert.equal(JSON.parse(await page.getByTestId('saved').innerText()).schedules[0].to, '22:30')

  console.log('PASS: legacy hours')
  // Intercept only synthetic fixture requests, never send mutations to an API.
  let reminderPayload
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'PATCH') reminderPayload = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto('http://127.0.0.1:5178/?mode=reminder')
  await page.getByRole('button', { name: 'Recordatorio de llenado habitual', exact: true }).click()
  await chooseTime(page.getByLabel('Hora diaria', { exact: true }), '1', '15', '13:15')
  await chooseTime(page.getByLabel('Martes · 12:00–23:00', { exact: true }), '3', '30', '15:30')
  screenshot('reminder-times.png')
  await page.getByRole('button', { name: 'Guardar recordatorio', exact: true }).click()
  await expect.poll(() => reminderPayload?.reminder?.dailyAt).toBe('13:15')
  assert.equal(reminderPayload.reminder.intervals[0].at, '15:30')
  const result = { userAgent, android: adb('shell', 'getprop', 'ro.build.version.release').toString().trim(), api: adb('shell', 'getprop', 'ro.build.version.sdk').toString().trim(), checks: ['native touch opens Hasta', 'native dial edits 23:00 to 22:30', 'wizard summary', 'onSave receives new time', 'fixture localStorage persists after reload', 'native touch opens Desde', 'Cancel keeps 12:00', 'Android IME clears capacity without zero; empty blocks Next; replacement saves 12', 'group minutes empty then 45 via Android IME', 'legacy RHF Desde/Hasta native dial + submit', 'daily and interval reminder native dial + intercepted save'], limitation: 'Real ServiceConfigDrawer in isolated fixture. No staging backend persistence, Samsung Internet or Alberto device validation. Native dial selectors expect English locale and 12h format.' }
  fs.writeFileSync(path.join(out, 'android-result.json'), JSON.stringify(result, null, 2))
  console.log(result)
} finally { await browser.close() }
