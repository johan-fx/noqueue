import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('turn presentation rises opaquely above a dimmed native-only background', async () => {
  const css = await read('../../web/src/index.css')
  const keyframes = name => css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  const enter = keyframes('noqueue-native-enter-bottom-up')
  assert.match(enter, /from \{ transform: translateY\(100%\); opacity: 1;/)
  assert.match(enter, /to \{ transform: translateY\(0\); opacity: 1;/)
  const background = keyframes('noqueue-native-dim-background')
  assert.match(background, /brightness\(var\(--noqueue-native-background-brightness\)\); opacity: 1;/)
  assert.doesNotMatch(background, /transform:|opacity: 0/)
  for (const snapshot of ['old', 'new']) {
    assert.ok(css.includes(`html[data-native-viewport='true'][data-noqueue-transition-intent='bottom-up']::view-transition-${snapshot}(root)`))
  }
  assert.match(css, /--noqueue-native-present-duration: 420ms/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/)
})

test('cancelled confirmation keeps lateral back styles without vertical dismissal', async () => {
  const css = await read('../../web/src/index.css')
  assert.doesNotMatch(css, /top-down|noqueue-native-reveal-background/)
  assert.match(css, /animation: noqueue-native-leave-back var\(--noqueue-native-slide-duration\)/)
  assert.match(css, /animation: noqueue-native-enter-bottom-up var\(--noqueue-native-present-duration\)/)
})

test('all iOS app, test and project targets require iOS 18', async () => {
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map(match => match[1])
  assert.equal(targets.length, 6, 'Check Debug/Release for the app, test and project configurations')
  assert.deepEqual([...new Set(targets)], ['18.0'])
  assert.doesNotMatch(project, /IPHONEOS_DEPLOYMENT_TARGET = (?:1[0-7]|[0-9])\.0;/)

  const plugin = await read('../../../packages/native-fcm/Package.swift')
  assert.match(plugin, /^\/\/ swift-tools-version: 6\.0/m)
  assert.match(plugin, /swiftLanguageModes:\s*\[\.v5\]/)
  assert.match(plugin, /platforms:\s*\[\.iOS\(\.v18\)\]/)
  assert.doesNotMatch(plugin, /\.iOS\(\.v(?:15|16|17)\)/)

  const config = await read('../capacitor.config.ts')
  assert.match(config, /swiftToolsVersion:\s*'6\.0'/)
  const generatedSpm = await read('../ios/App/CapApp-SPM/Package.swift')
  assert.match(generatedSpm, /platforms:\s*\[\.iOS\(\.v18\)\]/)
  assert.match(generatedSpm, /^\/\/ swift-tools-version: 6\.0/m, 'cap sync ios must regenerate Capacitor SPM with iOS 18-capable PackageDescription')
})

test('the shared transition scenario remains only in the simulator XCTest bundle', async () => {
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  const appSources = project.match(/504EC3001FED79650016851F \/\* Sources \*\/ = \{([\s\S]*?)\n\t\t\};/)
  const appResources = project.match(/504EC3021FED79650016851F \/\* Resources \*\/ = \{([\s\S]*?)\n\t\t\};/)
  const testSources = project.match(/F10000000000000000000008 = \{isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([^)]*)\)/)
  const testResources = project.match(/F20000000000000000000003 = \{isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([^)]*)\)/)
  assert.ok(appSources && appResources && testSources && testResources)
  assert.doesNotMatch(appSources[1], /TransitionSmokeTests|A10000000000000000000001/)
  assert.doesNotMatch(appResources[1], /transition-scenarios|F20000000000000000000004/)
  assert.match(testSources[1], /TransitionSmokeTests\.swift in Sources/)
  assert.match(testResources[1], /F20000000000000000000004/)
  assert.match(project, /productType = "com\.apple\.product-type\.bundle\.unit-test"/)
})

test('iOS transition runner checks the built minimum and records the selected runtime', async () => {
  const pkg = JSON.parse(await read('../package.json'))
  assert.equal(pkg.scripts['test:ios:transitions'], 'node scripts/ios-transitions.mjs')
  const runner = await read('./ios-transitions.mjs')
  assert.match(runner, /MinimumOSVersion, '18\.0'/)
  assert.match(runner, /IOS_TRANSITIONS_EXPECT_RUNTIME/)
  assert.match(runner, /'recordVideo'/)
  assert.match(runner, /TransitionSmokeTests\/testNativeViewTransitions/)
  assert.match(runner, /__local\/evidence/)
  assert.doesNotMatch(runner, /'erase'|'uninstall'|--allowProvisioningUpdates/)
})

test('Android transition runner uses real API-36 WebView over CDP and keeps evidence local', async () => {
  const pkg = JSON.parse(await read('../../../tests/e2e/package.json'))
  assert.equal(pkg.scripts['test:android:transitions'], 'node mobile/android-transitions.mjs')
  const runner = await read('../../../tests/e2e/mobile/android-transitions.mjs')
  assert.match(runner, /noqueue-api36/)
  assert.match(runner, /getprop', 'ro\.build\.version\.sdk'/)
  assert.match(runner, /dumpsys', 'webviewupdate'/)
  assert.match(runner, /chromium\.connectOverCDP/)
  assert.match(runner, /emulateMedia\(\{ reducedMotion: 'reduce' \}\)/)
  assert.match(runner, /screenrecord/)
  assert.doesNotMatch(runner, /ignoreHTTPSErrors|rejectUnauthorized:\s*false|shell', 'pm', 'clear'/)
})

test('shared native scenario instruments safe View Transition lifecycle without exposing route capabilities', async () => {
  const scenario = await read('../ios/App/AppLocalTests/transition-scenarios.js')
  assert.doesNotThrow(() => new Function(`return ${scenario}`), 'shared executable scenario must parse')
  assert.match(scenario, /document\.startViewTransition/)
  for (const phase of ['start', 'ready', 'finished']) assert.match(scenario, new RegExp(`'${phase}'`))
  assert.match(scenario, /dataset\.noqueueTransitionIntent/)
  for (const intent of ['forward', 'back', 'bottom-up', 'replace', 'none']) assert.match(scenario, new RegExp(`'${intent}'`))
  assert.match(scenario, /prefers-reduced-motion: reduce/)
  assert.match(scenario, /query and filter updates do not trigger route transitions/)
  assert.match(scenario, /resource polling does not trigger route transitions/)
  assert.match(scenario, /current rendered search screen remains until the destination is prepared/)
  assert.match(scenario, /reduced-motion pass starts on the cancelled test turn/)
  assert.match(scenario, /skips transitions under reduced motion/)
  assert.match(scenario, /window\.fetch = nativeFetch/)
  assert.doesNotMatch(scenario.split('return {\n      status: \'passed\'')[1] ?? '', /activeToken|recoveryToken|Authorization|Bearer/)
})
