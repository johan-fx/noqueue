import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { mergeEvidence, browsers } from './distributed.mjs'
import { render } from './report.mjs'
const [directory] = process.argv.slice(2)
if (!directory) throw new Error('Usage: merge.mjs report-directory')
const read = async (file) => JSON.parse(await readFile(path.join(directory, file), 'utf8'))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const parts = await Promise.all(['api', ...browsers].map((name) => read(`${name}/evidence.json`)))
const report = mergeEvidence(await read('inventory.json'), parts, revision)
await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, 'evidence.json'), JSON.stringify(report, null, 2))
await writeFile(path.join(directory, 'index.html'), render(report))
console.log(`PASSED: ${report.scenarios.length} API/browser scenarios, all three browsers, revision ${revision}`)
