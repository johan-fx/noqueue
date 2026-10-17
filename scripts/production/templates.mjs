// Narrow operator tool: inventory or change ONLY existing production URL-button origins.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { readConfig } from './config.mjs'
const legacy = 'https://noqueue-app.com', production = 'https://app.noqueue-app.com'
export function productionURLUpdate(template) {
  assert.match(template.name, /^noqueue_v4_[a-z_]+_(es|en)_production$/)
  assert.ok(['es_ES', 'en_US'].includes(template.language))
  const components = structuredClone(template.components)
  const buttons = components.filter(c => c.type === 'BUTTONS').flatMap(c => c.buttons ?? [])
  const urls = buttons.filter(b => b.type === 'URL')
  assert.equal(urls.length, 1, 'Expected one native URL button')
  let changed = false
  for (const button of urls) {
    assert.match(button.url, /^https:\/\/(?:app\.)?noqueue-app\.com\/(t|v)\/\{\{1\}\}$/)
    if (button.url.startsWith(legacy + '/')) { button.url = production + button.url.slice(legacy.length); changed = true }
    if (Array.isArray(button.example)) button.example = button.example.map(value => typeof value === 'string' && value.startsWith(legacy + '/') ? production + value.slice(legacy.length) : value)
  }
  return { changed, components }
}
async function main() {
  const { values } = parseArgs({ options: { 'env-file': { type: 'string' }, apply: { type: 'boolean' } } })
  assert.ok(values['env-file'], 'Explicit private --env-file required')
  const match = (await readFile(resolve(values['env-file']), 'utf8')).match(/^D360DIALOG_API_KEY\s*=\s*(.*?)\s*$/m)
  let key = match?.[1] ?? ''
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1)
  assert.ok(key, 'Missing provider credential')
  async function request(path, method = 'GET', body) {
    const response = await fetch('https://waba-v2.360dialog.io' + path, { method, headers: { 'D360-API-KEY': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(25000) })
    const data = await response.json()
    if (!response.ok) { const error = new Error(`Provider ${method} returned HTTP ${response.status}; no retry`); error.details = data; throw error }
    return data
  }
  const inventory = (await request('/v1/configs/templates')).waba_templates
  const names = Object.entries((await readConfig()).env.production.vars).filter(([name]) => name.startsWith('WHATSAPP_QUEUE_V4_')).map(([, value]) => value)
  assert.equal(names.length, 24)
  const selected = names.map(name => {
    const matches = inventory.filter(t => t.name === name)
    assert.equal(matches.length, 1, 'Missing/ambiguous template: ' + name)
    assert.equal(matches[0].waba_account_id, 'SDHjZnWA', 'Unexpected channel template account')
    return matches[0]
  })
  const targets = selected.filter(t => t.name.endsWith('_production'))
  assert.equal(targets.length, 14)
  // Validate the entire diff before any write; preserve all bodies, categories and button order.
  const updates = targets.map(t => ({ template: t, ...productionURLUpdate(t) }))
  const directory = resolve('reports/production-private/templates')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '')
  await writeFile(resolve(directory, stamp + '-before.json'), JSON.stringify(selected, null, 2), { mode: 0o600, flag: 'wx' })
  const report = { at: new Date().toISOString(), apply: values.apply === true, results: [] }
  const reportPath = resolve(directory, stamp + '-report.json')
  async function save() { await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }) }
  await save()
  for (const update of updates) {
    const { template, changed, components } = update
    const row = { name: template.name, previousStatus: template.status, category: template.category, changed, outcome: changed ? 'planned' : 'already-correct' }
    report.results.push(row); await save()
    if (values.apply && changed) {
      assert.equal(template.status, 'approved', 'Only previously approved production templates may be edited')
      assert.match(template.external_id, /^\d+$/)
      row.outcome = 'request-started'; await save()
      try {
        const result = await request('/message_templates/' + template.external_id, 'POST', { components })
        assert.equal(result.success, true, 'Provider did not confirm template edit')
        row.outcome = 'submitted'; await save()
      } catch (error) {
        row.outcome = 'failed-or-uncertain'; await save()
        await writeFile(resolve(directory, stamp + '-error.json'), JSON.stringify(error.details ?? { message: 'Outcome uncertain; inspect provider before retrying' }), { mode: 0o600 })
        throw new Error('Template update stopped; inspect private report and provider before retrying')
      }
    }
  }
  const after = values.apply ? (await request('/v1/configs/templates')).waba_templates.filter(t => names.includes(t.name)) : selected
  await writeFile(resolve(directory, stamp + '-after.json'), JSON.stringify(after, null, 2), { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ report: reportPath, applied: values.apply === true, templates: after.map(t => ({ name: t.name, status: t.status, category: t.category, urls: t.components.filter(c => c.type === 'BUTTONS').flatMap(c => c.buttons ?? []).filter(b => b.type === 'URL').map(b => b.url) })) }, null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  try { await main() } catch (error) { console.error(error.message); process.exitCode = 1 }
