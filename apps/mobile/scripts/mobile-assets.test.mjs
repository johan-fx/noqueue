import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { buildAssetOutputs, compositeOpaqueMark } from './mobile-assets.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { outputs, staleFiles } = await buildAssetOutputs();

function output(relativePath) {
  const value = outputs.get(relativePath);
  assert.ok(value, 'expected generated file: ' + relativePath);
  return value;
}

async function dimensions(relativePath) {
  const meta = await sharp(output(relativePath)).metadata();
  return [meta.width, meta.height];
}

test('brand sources retain the complete Figma lockup', async () => {
  for (const name of ['noqueue-mark.svg', 'noqueue-splash.svg']) {
    const source = await fs.readFile(path.join(APP_ROOT, 'assets/brand', name), 'utf8');
    assert.equal((source.match(/<path\b/g) || []).length, 13, name + ' must retain all 13 vector paths');
  }
  const splashSource = await fs.readFile(path.join(APP_ROOT, 'assets/brand/noqueue-splash.svg'), 'utf8');
  assert.match(splashSource, /<g\b[^>]*opacity=\"0\.5\"/, 'the Figma source remains unchanged');
  const splash = output('ios/App/App/Assets.xcassets/Splash.imageset/SplashLogo@3x.png');
  const { data, info } = await sharp(splash).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaqueBrandPixel = false;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] === 255) {
      assert.deepEqual([...data.subarray(i, i + 3)], [31, 41, 55], 'splash final-state mark is opaque brand navy');
      opaqueBrandPixel = true;
      break;
    }
  }
  assert.ok(opaqueBrandPixel, 'splash renderer normalizes the motion export to the approved static opacity 1');
});

test('store and iOS app icon exports have the required pixel sizes', async () => {
  assert.deepEqual(await dimensions('assets/store/app-icon-512.png'), [512, 512]);
  assert.deepEqual(await dimensions('assets/store/google-play-feature-1024x500.png'), [1024, 500]);
  assert.deepEqual(await dimensions('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), [1024, 1024]);
  for (const name of [
    'assets/store/app-icon-512.png',
    'assets/store/google-play-feature-1024x500.png',
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
  ]) {
    assert.equal((await sharp(output(name)).metadata()).hasAlpha, false, name + ' must be opaque for store submission');
  }
  assert.deepEqual(await dimensions('ios/App/App/Assets.xcassets/Splash.imageset/SplashLogo.png'), [125, 196]);
  assert.deepEqual(await dimensions('ios/App/App/Assets.xcassets/Splash.imageset/SplashLogo@2x.png'), [250, 392]);
  assert.deepEqual(await dimensions('ios/App/App/Assets.xcassets/Splash.imageset/SplashLogo@3x.png'), [375, 588]);
});

test('Android launcher, monochrome, splash and notification resources use density-aware bounds', async () => {
  const scales = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [density, scale] of Object.entries(scales)) {
    const side = Math.round(108 * scale);
    assert.deepEqual(await dimensions('android/app/src/main/res/mipmap-' + density + '/ic_launcher_foreground.png'), [side, side]);
    assert.deepEqual(await dimensions('android/app/src/main/res/mipmap-' + density + '/ic_launcher_monochrome.png'), [side, side]);
    assert.deepEqual(await dimensions('android/app/src/main/res/drawable-' + density + '/ic_stat_noqueue.png'), [Math.round(24 * scale), Math.round(24 * scale)]);
    assert.deepEqual(await dimensions('android/app/src/main/res/mipmap-' + density + '/ic_launcher.png'), [Math.round(48 * scale), Math.round(48 * scale)]);
    assert.deepEqual(await dimensions('android/app/src/main/res/drawable-' + density + '/splash_logo.png'), [288 * scale, 288 * scale]);
    for (const [name, radius, color] of [
      ['drawable-' + density + '/splash_logo.png', 96 * scale, [31, 41, 55]],
      ['mipmap-' + density + '/ic_launcher_foreground.png', 33 * scale, [31, 41, 55]],
      ['mipmap-' + density + '/ic_launcher_monochrome.png', 33 * scale, [255, 255, 255]],
    ]) {
      const { data, info } = await sharp(output('android/app/src/main/res/' + name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let opaquePixels = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        if (data[i + 3] > 0) assert.ok(Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) <= radius, name + ' must fit its safe circle');
        if (data[i + 3] === 255) { assert.deepEqual([...data.subarray(i, i + 3)], color, name + ' preserves approved navy'); opaquePixels++; }
      }
      assert.ok(opaquePixels > 0, name + ' is not empty');
    }
  }

  const adaptive = output('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml').toString('utf8');
  const themedAdaptive = output('android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml').toString('utf8');
  assert.doesNotMatch(adaptive, /<monochrome\b/, 'API 26 adaptive XML stays compatible with older Android parsers');
  assert.match(themedAdaptive, /<monochrome\b/, 'Android 13 themed icon layer exists');
  assert.match(adaptive, /ic_launcher_foreground/);
  const colorsXml = output('android/app/src/main/res/values/colors.xml').toString('utf8');
  const legacyColorsXml = output('android/app/src/main/res/values/ic_launcher_background.xml').toString('utf8');
  assert.match(colorsXml, /name=\"brand_notification_color\"/);
  const resourceNames = [...colorsXml, ...legacyColorsXml].join('').match(/<color name=\"([^\"]+)\"/g) || [];
  assert.equal(resourceNames.length, new Set(resourceNames).size, 'Android color resource names are unique');
});

test('notification mark is a white alpha mask and launch-only styling preserves app UI', async () => {
  const icon = output('android/app/src/main/res/drawable-mdpi/ic_stat_noqueue.png');
  const { data, info } = await sharp(icon).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const visible = [];
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] > 0) visible.push([...data.subarray(i, i + 4)]);
  }
  assert.ok(visible.length > 0);
  assert.ok(visible.every(([r, g, b]) => r === 255 && g === 255 && b === 255), 'visible notification pixels are white only');
  const styles = output('android/app/src/main/res/values/styles.xml').toString('utf8');
  assert.match(styles, /<style name=\"AppTheme.NoActionBar\"/);
  assert.match(styles, /<item name=\"android:windowBackground\">#FFFFFF<\/item>/, 'regular app surface remains unchanged');
  assert.match(styles, /<style name=\"AppTheme.NoActionBarLaunch\"/);
});

test('opaque composition uses exact integer source-over with transparent, partial and opaque pixels', async () => {
  const background = await sharp({ create: { width: 5, height: 1, channels: 4, background: { r: 200, g: 150, b: 100, alpha: 1 } } }).png().toBuffer();
  const mark = await sharp(Buffer.from([10, 20, 30, 0, 10, 20, 30, 128, 10, 20, 30, 255]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
  const result = await compositeOpaqueMark(background, mark, 1, 0);
  assert.deepEqual([...await sharp(result).raw().toBuffer()], [
    200, 150, 100, 255, 200, 150, 100, 255, 105, 85, 65, 255, 10, 20, 30, 255, 200, 150, 100, 255,
  ]);
  await assert.rejects(compositeOpaqueMark(mark, mark, 0, 0), /opaque background/);
});

test('generator is deterministic and obsolete splash/logo resources are absent', async () => {
  const second = await buildAssetOutputs();
  assert.deepEqual([...second.outputs.keys()], [...outputs.keys()]);
  for (const [name, value] of outputs) assert.ok(value.equals(second.outputs.get(name)), name + ' should be deterministic');
  for (const relativePath of staleFiles) {
    await assert.rejects(fs.access(path.join(APP_ROOT, relativePath)), relativePath + ' should be removed');
  }
  const check = spawnSync(process.execPath, [path.join(APP_ROOT, 'scripts/mobile-assets.mjs'), '--check'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /up to date/);
});
