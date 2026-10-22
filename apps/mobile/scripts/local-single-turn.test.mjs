import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const migration = readFileSync(new URL('../../api/migrations/0031_mobile_single_active_turn.sql', import.meta.url), 'utf8')
test('migration refuses legacy duplicates without silently cancelling either entry', () => {
  const result = execFileSync('python3', ['-c', `
import sqlite3,sys
sql=sys.stdin.read()
db=sqlite3.connect(':memory:')
db.executescript("CREATE TABLE queue_entry(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE mobile_entry_installation(entry_id TEXT PRIMARY KEY,installation_hash TEXT); INSERT INTO queue_entry VALUES('a','waiting'),('b','called'); INSERT INTO mobile_entry_installation VALUES('a','same'),('b','same');")
try:
 db.executescript(sql)
 raise Exception('migration accepted duplicate active turns')
except sqlite3.IntegrityError: pass
assert db.execute('SELECT status FROM queue_entry ORDER BY id').fetchall()==[('waiting',),('called',)]
print('preflight rejected duplicates without mutation')
`], { input: migration, encoding: 'utf8' })
  assert.match(result, /preflight rejected/)
})
test('discovery permissions are optional and never include microphone, gallery or background location', () => {
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
  const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8')
  assert.match(manifest, /android.permission.CAMERA/)
  assert.match(manifest, /android.permission.ACCESS_COARSE_LOCATION/)
  assert.match(manifest, /android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30"/)
  assert.doesNotMatch(manifest, /RECORD_AUDIO|READ_MEDIA|ACCESS_BACKGROUND_LOCATION/)
  assert.match(plist, /NSCameraUsageDescription/)
  assert.match(plist, /NSLocationWhenInUseUsageDescription/)
  assert.doesNotMatch(plist, /NSMicrophoneUsageDescription|NSPhotoLibraryUsageDescription|UIBackgroundModes/)
})
