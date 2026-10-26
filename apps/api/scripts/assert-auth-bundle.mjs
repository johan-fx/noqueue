import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Run against Wrangler's output before uploading a Worker. A dependency update
// must not silently restore the abort-sensitive Better Auth dynamic import.
const source = await readFile(process.argv[2], 'utf8')
assert.match(source, /import\s*\{[^}]*AsyncLocalStorage[^}]*\}\s*from\s*["']node:async_hooks["']/)
assert.doesNotMatch(source, /import\(\s*(?:\/\*[\s\S]*?\*\/\s*)*["']node:async_hooks["']/)
assert.doesNotMatch(source, /AsyncLocalStoragePromise/)
console.log('Worker auth bundle: static AsyncLocalStorage verified')
