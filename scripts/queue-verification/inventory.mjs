import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { browserInventory } from './results.mjs'
const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: inventory.mjs playwright-list.json inventory.json')
const tests = browserInventory(JSON.parse(await readFile(input, 'utf8')))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
await writeFile(output, JSON.stringify({ format: 'queue-inventory-v1', revision, tests }, null, 2))
console.log(`Inventoried ${tests.length} browser tests at ${revision}`)
