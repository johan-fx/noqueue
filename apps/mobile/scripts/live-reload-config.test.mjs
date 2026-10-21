import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
const code = ts.transpileModule(readFileSync(new URL('../capacitor.config.ts', import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { liveReloadServer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('live reload fails closed unless explicit HTTPS private development URL', () => {
  assert.equal(liveReloadServer(undefined, undefined), undefined)
  assert.deepEqual(liveReloadServer('https://192.168.1.38:5173','1'), { url: 'https://192.168.1.38:5173', cleartext: false })
  assert.throws(() => liveReloadServer('https://192.168.1.38:5173',undefined))
  for (const url of ['http://192.168.1.38:5173','https://8.8.8.8:5173','https://0.0.0.0:5173','https://app.example:5173','https://192.168.1.38:5173/path','https://user:pw@192.168.1.38:5173','https://192.168.1.38:5173?x=1','https://192.168.1.38:443','https://192.168.1.38:5173/#x']) assert.throws(() => liveReloadServer(url,'1'))
})
test('Xcode rejects live reload outside Debug', { skip: process.platform !== 'darwin' }, () => {
  const root = mkdtempSync(path.join(tmpdir(),'noqueue-release-guard-'))
  try {
    mkdirSync(path.join(root,'App'))
    const config = path.join(root,'App/capacitor.config.json')
    writeFileSync(config, JSON.stringify({ server: { url: 'https://192.168.1.38:5173' } }))
    const run = configuration => execFileSync('/bin/sh',[new URL('./verify-ios-environment.sh',import.meta.url).pathname],{env:{...process.env,SRCROOT:root,CONFIGURATION:configuration},stdio:'pipe'})
    assert.doesNotThrow(() => run('Debug'))
    assert.throws(() => run('Release'))
    writeFileSync(config, '{}')
    assert.doesNotThrow(() => run('Release'))
  } finally { rmSync(root,{ recursive:true,force:true }) }
})
