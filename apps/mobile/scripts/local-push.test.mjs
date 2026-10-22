import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = p => readFile(new URL(p, import.meta.url), 'utf8')
test('push is OFF by default; no app-side provider secrets or automatically granted permissions', async () => {
  assert.match(await read('../../web/.env.example'), /VITE_MOBILE_PUSH_ENABLED=false/)
  assert.match(await read('../../api/.dev.vars.example'), /MOBILE_PUSH_ENABLED=false/)
  assert.match(await read('../../api/.dev.vars.example'), /APNS_TRANSPORT_VERIFIED=false/)
  const controller = await read('../../web/src/platform/capacitor/push-registration.ts')
  assert.doesNotMatch(controller, /console\.|localStorage|sessionStorage|APNS_PRIVATE_KEY|FCM_PRIVATE_KEY/)
  assert.match(controller, /pushResolutionSchema.parse/)
})
test('native APNs callbacks are wired; entitlement is device-only and explicitly separates Debug/Release', async () => {
  const swift = await read('../ios/App/App/AppDelegate.swift')
  assert.match(swift, /capacitorDidRegisterForRemoteNotifications/)
  assert.match(swift, /capacitorDidFailToRegisterForRemoteNotifications/)
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  assert.equal(project.match(/CODE_SIGN_ENTITLEMENTS\[sdk=iphoneos\*\]/g).length, 2)
  assert.match(project, /APS_ENVIRONMENT = development/)
  assert.match(project, /APS_ENVIRONMENT = production/)
  assert.match(project, /com.apple.Push = \{ enabled = 1;/)
  assert.match(await read('../ios/App/App/App.entitlements'), /\$\(APS_ENVIRONMENT\)/)
  assert.match(await read('../capacitor.config.ts'), /presentationOptions: \[\]/)
  assert.doesNotMatch(await read('../ios/App/App/Info.plist'), /remote-notification/)
})
test('registered platform IDs and Apple team are consistent with the native runners', async () => {
  const project = await read('../ios/App/App.xcodeproj/project.pbxproj')
  assert.equal(project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.noqueue-app\.ios;/g)?.length, 2)
  assert.equal(project.match(/DEVELOPMENT_TEAM = 6VYYNUZPSH;/g)?.length, 2)
  assert.doesNotMatch(await read('./ios-smoke.mjs'), /com\.noqueue\.app/)
  assert.doesNotMatch(await read('../ios/App/AppLocalTests/LocalSmokeTests.swift'), /com\.noqueue\.app/)
  assert.match(await read('../android/app/build.gradle'), /applicationId "com.noqueue.app"/)
  assert.match(await read('../capacitor.config.ts'), /appId: platform === 'ios' \? 'com.noqueue-app.ios' : 'com.noqueue.app'/)
  const pkg = JSON.parse(await read('../package.json'))
  for (const command of ['copy', 'sync']) {
    assert.ok(pkg.scripts[command].includes(`NOQUEUE_NATIVE_PLATFORM=ios cap ${command} ios`))
    assert.ok(pkg.scripts[command].includes(`NOQUEUE_NATIVE_PLATFORM=android cap ${command} android`))
  }
})
test('Firebase client configuration cannot silently opt in to messaging or analytics', async () => {
  const manifest = await read('../android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android:name="firebase_messaging_auto_init_enabled" android:value="false"/)
  assert.match(manifest, /android:name="firebase_analytics_collection_enabled" android:value="false"/)
  assert.match(manifest, /android:name="firebase_analytics_collection_deactivated" android:value="true"/)
  const ignore = await read('../../../.gitignore')
  assert.match(ignore, /\*\.p8/)
  assert.match(ignore, /apps\/mobile\/android\/app\/google-services\.json/)
})

test('Turbo build cache separates explicit mobile push opt-in from OFF builds', async () => {
  const turbo = JSON.parse(await read('../../../turbo.json'))
  assert.ok(turbo.tasks.build.env.includes('VITE_MOBILE_PUSH_ENABLED'))
})

test('notification settings use compatible plugins and strip inherited exact-alarm permission', async () => {
  const mobile = JSON.parse(await read('../package.json'))
  const web = JSON.parse(await read('../../web/package.json'))
  for (const name of ['@capacitor/local-notifications', 'capacitor-native-settings']) {
    assert.match(mobile.dependencies[name], /^8\./)
    assert.equal(mobile.dependencies[name], web.dependencies[name])
  }
  const manifest = await read('../android/app/src/main/AndroidManifest.xml')
  for (const permission of ['SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM']) {
    assert.match(manifest, new RegExp(`android:name="android.permission.${permission}" tools:node="remove"`))
  }
  const permissions = await read('../../web/src/platform/capacitor/push-permissions.ts')
  assert.match(permissions, /LocalNotifications\.areEnabled\(\)/)
  assert.doesNotMatch(permissions, /LocalNotifications\.(?:schedule|requestPermissions|createChannel)\(/)
  assert.match(permissions, /IOSSettings\.AppNotification/)
  assert.doesNotMatch(permissions, /App-prefs:/)
})
