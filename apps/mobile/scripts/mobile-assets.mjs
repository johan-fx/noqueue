#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(APP_ROOT, 'assets');
const ANDROID_RES = path.join(APP_ROOT, 'android/app/src/main/res');
const IOS_ASSETS = path.join(APP_ROOT, 'ios/App/App/Assets.xcassets');

const COLORS = {
  logo: '#1F2937',
  splash: '#E1E1E0',
  gradientTop: '#E1E1E0',
  gradientBottom: '#B7B7B7',
  monochrome: '#FFFFFF',
};
const DENSITIES = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false };

function makeGradientSvg(width, height) {
  return [
    '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"' + width + '\" height=\"' + height + '\" viewBox=\"0 0 ' + width + ' ' + height + '\">',
    '<defs><linearGradient id=\"brand\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">',
    '<stop offset=\"0%\" stop-color=\"' + COLORS.gradientTop + '\"/>',
    '<stop offset=\"100%\" stop-color=\"' + COLORS.gradientBottom + '\"/>',
    '</linearGradient></defs><rect width=\"100%\" height=\"100%\" fill=\"url(#brand)\"/>',
    '</svg>',
  ].join('');
}

function normalizedSplashSvg(svg) {
  // Figma's static export keeps the motion's starting opacity (0.5). The
  // approved launch state is static at opacity 1; normalize only a render copy.
  return svg.replace(/(<g\b[^>]*?)\sopacity=\"0\.5\"([^>]*>)/, '$1$2');
}

function recolorSvg(svg, color) {
  return svg.replace(/fill=\"#1F2937\"/g, 'fill=\"' + color + '\"');
}

async function renderMark(svg, color, requestedWidth, requestedHeight) {
  const tinted = recolorSvg(svg, color);
  return sharp(Buffer.from(tinted))
    .resize({
      width: Math.max(1, Math.round(requestedWidth)),
      height: Math.max(1, Math.round(requestedHeight)),
      fit: 'inside',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function makeCanvas(width, height, background) {
  if (background === 'gradient') {
    return sharp(Buffer.from(makeGradientSvg(width, height))).png(PNG_OPTIONS).toBuffer();
  }
  if (background === 'solid') {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: COLORS.splash,
      },
    }).png(PNG_OPTIONS).toBuffer();
  }
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png(PNG_OPTIONS).toBuffer();
}

async function compositeMark(svg, width, height, options) {
  const background = await makeCanvas(width, height, options.background);
  const mark = await renderMark(svg, options.color, options.markWidth, options.markHeight);
  const markInfo = await sharp(mark).metadata();
  const left = Math.max(0, Math.round((width - markInfo.width) / 2));
  const top = Math.max(0, Math.round((height - markInfo.height) / 2));
  if (options.background !== 'transparent') return compositeOpaqueMark(background, mark, left, top);
  return sharp(background)
    .composite([{
      input: mark,
      left,
      top,
    }])
    .png(PNG_OPTIONS)
    .toBuffer();
}

// Native floating-point source-over differs by one color level on ARM/macOS
// and x64/Linux. Integer arithmetic keeps checked-in opaque assets byte-exact
// across both platforms, without tolerances or changing the vector sources.
export async function compositeOpaqueMark(background, mark, left, top) {
  const base = await sharp(background).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const foreground = await sharp(mark).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < base.data.length; i += 4) {
    if (base.data[i] !== 255) throw new Error('Opaque composition requires an opaque background');
  }
  for (let y = 0; y < foreground.info.height; y++) for (let x = 0; x < foreground.info.width; x++) {
    const source = (y * foreground.info.width + x) * 4;
    const target = ((top + y) * base.info.width + left + x) * 4;
    const alpha = foreground.data[source + 3];
    for (let channel = 0; channel < 3; channel++) {
      base.data[target + channel] = Math.floor((foreground.data[source + channel] * alpha +
        base.data[target + channel] * (255 - alpha) + 127) / 255);
    }
  }
  return sharp(base.data, { raw: { width: base.info.width, height: base.info.height, channels: 4 } }).png(PNG_OPTIONS).toBuffer();
}

function toAndroidAdaptiveXml(includeMonochrome) {
  const lines = [
    '<?xml version=\"1.0\" encoding=\"utf-8\"?>',
    '<adaptive-icon xmlns:android=\"http://schemas.android.com/apk/res/android\">',
    '    <background android:drawable=\"@drawable/ic_launcher_background\"/>',
    '    <foreground android:drawable=\"@mipmap/ic_launcher_foreground\"/>',
  ];
  if (includeMonochrome) lines.push('    <monochrome android:drawable=\"@mipmap/ic_launcher_monochrome\"/>');
  lines.push('</adaptive-icon>', '');
  return lines.join('\n');
}

function toAndroidGradientDrawable() {
  return [
    '<?xml version=\"1.0\" encoding=\"utf-8\"?>',
    '<shape xmlns:android=\"http://schemas.android.com/apk/res/android\" android:shape=\"rectangle\">',
    '    <gradient android:angle=\"270\" android:startColor=\"' + COLORS.gradientTop + '\" android:endColor=\"' + COLORS.gradientBottom + '\" android:type=\"linear\"/>',
    '</shape>',
    '',
  ].join('\n');
}

function toAndroidSplashDrawable() {
  return [
    '<?xml version=\"1.0\" encoding=\"utf-8\"?>',
    '<layer-list xmlns:android=\"http://schemas.android.com/apk/res/android\">',
    '    <item android:drawable=\"@color/brand_splash_background\"/>',
    '    <item>',
    '        <bitmap android:gravity=\"center\" android:src=\"@drawable/splash_logo\"/>',
    '    </item>',
    '</layer-list>',
    '',
  ].join('\n');
}

function toAndroidColors() {
  return [
    '<?xml version=\"1.0\" encoding=\"utf-8\"?>',
    '<resources>',
    '    <color name=\"brand_notification_color\">' + COLORS.logo + '</color>',
    '    <color name=\"brand_splash_background\">' + COLORS.splash + '</color>',
    '</resources>',
    '',
  ].join('\n');
}

function toAndroidLaunchStyle() {
  return [
    '    <!-- Brand colors are launch/notification only; regular app surfaces remain unchanged. -->',
    '    <style name=\"AppTheme.NoActionBarLaunch\" parent=\"Theme.SplashScreen\">',
    '        <item name=\"android:background\">@drawable/splash</item>',
    '        <item name=\"android:statusBarColor\">@color/brand_splash_background</item>',
    '        <item name=\"android:windowLightStatusBar\">true</item>',
    '        <item name=\"android:enforceStatusBarContrast\">false</item>',
    '        <item name=\"windowSplashScreenBackground\">@color/brand_splash_background</item>',
    '        <item name=\"windowSplashScreenAnimatedIcon\">@drawable/splash_logo</item>',
    '        <item name=\"windowSplashScreenAnimationDuration\">0</item>',
    '        <item name=\"postSplashScreenTheme\">@style/AppTheme.NoActionBar</item>',
    '    </style>',
  ].join('\n');
}

function toIosAppIconContents() {
  return JSON.stringify({
    images: [{
      filename: 'AppIcon-512@2x.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    }],
    info: { author: 'xcode', version: 1 },
  }, null, 2) + '\n';
}

function toIosSplashContents() {
  return JSON.stringify({
    images: [
      { idiom: 'universal', filename: 'SplashLogo.png', scale: '1x' },
      { idiom: 'universal', filename: 'SplashLogo@2x.png', scale: '2x' },
      { idiom: 'universal', filename: 'SplashLogo@3x.png', scale: '3x' },
    ],
    info: { version: 1, author: 'xcode' },
  }, null, 2) + '\n';
}

function toIosLaunchStoryboard() {
  return [
    '<?xml version=\"1.0\" encoding=\"UTF-8\"?>',
    '<document type=\"com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB\" version=\"3.0\" toolsVersion=\"17132\" targetRuntime=\"iOS.CocoaTouch\" propertyAccessControl=\"none\" useAutolayout=\"YES\" launchScreen=\"YES\" useTraitCollections=\"YES\" useSafeAreas=\"YES\" colorMatched=\"YES\" initialViewController=\"01J-lp-oVM\">',
    '    <device id=\"retina4_7\" orientation=\"portrait\" appearance=\"light\"/>',
    '    <dependencies>',
    '        <deployment identifier=\"iOS\"/>',
    '        <plugIn identifier=\"com.apple.InterfaceBuilder.IBCocoaTouchPlugin\" version=\"17105\"/>',
    '        <capability name=\"System colors in document resources\" minToolsVersion=\"11.0\"/>',
    '        <capability name=\"documents saved in the Xcode 8 format\" minToolsVersion=\"8.0\"/>',
    '    </dependencies>',
    '    <scenes>',
    '        <scene sceneID=\"EHf-IW-A2E\">',
    '            <objects>',
    '                <viewController id=\"01J-lp-oVM\" sceneMemberID=\"viewController\">',
    '                    <view key=\"view\" contentMode=\"scaleToFill\" id=\"root\">',
    '                        <rect key=\"frame\" x=\"0.0\" y=\"0.0\" width=\"375\" height=\"667\"/>',
    '                        <autoresizingMask key=\"autoresizingMask\"/>',
    '                        <subviews>',
    '                            <imageView userInteractionEnabled=\"NO\" contentMode=\"scaleAspectFit\" image=\"Splash\" translatesAutoresizingMaskIntoConstraints=\"NO\" id=\"splash-logo\">',
    '                                <rect key=\"frame\" x=\"125\" y=\"235.5\" width=\"125\" height=\"196\"/>',
    '                            </imageView>',
    '                        </subviews>',
    '                        <viewLayoutGuide key=\"safeArea\" id=\"safeArea\"/>',
    '                        <color key=\"backgroundColor\" red=\"0.882353\" green=\"0.882353\" blue=\"0.878431\" alpha=\"1\" colorSpace=\"custom\" customColorSpace=\"sRGB\"/>',
    '                        <constraints>',
    '                            <constraint firstItem=\"splash-logo\" firstAttribute=\"centerX\" secondItem=\"root\" secondAttribute=\"centerX\" id=\"logo-center-x\"/>',
    '                            <constraint firstItem=\"splash-logo\" firstAttribute=\"centerY\" secondItem=\"root\" secondAttribute=\"centerY\" id=\"logo-center-y\"/>',
    '                            <constraint firstItem=\"splash-logo\" firstAttribute=\"width\" secondItem=\"root\" secondAttribute=\"width\" multiplier=\"0.32\" id=\"logo-width\"/>',
    '                            <constraint firstItem=\"splash-logo\" firstAttribute=\"height\" secondItem=\"splash-logo\" secondAttribute=\"width\" multiplier=\"1.565\" id=\"logo-aspect\"/>',
    '                        </constraints>',
    '                    </view>',
    '                </viewController>',
    '                <placeholder placeholderIdentifier=\"IBFirstResponder\" id=\"iYj-Kq-Ea1\" userLabel=\"First Responder\" sceneMemberID=\"firstResponder\"/>',
    '            </objects>',
    '            <point key=\"canvasLocation\" x=\"53\" y=\"375\"/>',
    '        </scene>',
    '    </scenes>',
    '    <resources><image name=\"Splash\" width=\"125\" height=\"196\"/></resources>',
    '</document>',
    '',
  ].join('\n');
}

function jsonBuffer(value) {
  return Buffer.from(value, 'utf8');
}

function addOutput(outputs, absolutePath, contents) {
  outputs.set(path.relative(APP_ROOT, absolutePath), Buffer.isBuffer(contents) ? contents : jsonBuffer(contents));
}

export async function buildAssetOutputs() {
  const markPath = path.join(ASSETS, 'brand/noqueue-mark.svg');
  const splashPath = path.join(ASSETS, 'brand/noqueue-splash.svg');
  const markSvg = await fs.readFile(markPath, 'utf8');
  const splashSourceSvg = await fs.readFile(splashPath, 'utf8');
  const splashSvg = normalizedSplashSvg(splashSourceSvg);
  if ((markSvg.match(/<path\b/g) || []).length !== 13) {
    throw new Error('Expected the full 13-path Figma logo in noqueue-mark.svg');
  }
  if ((splashSourceSvg.match(/<path\b/g) || []).length !== 13) {
    throw new Error('Expected the full 13-path Figma logo in noqueue-splash.svg');
  }

  const outputs = new Map();
  const appIcon = await compositeMark(markSvg, 1024, 1024, {
    background: 'gradient',
    color: COLORS.logo,
    markWidth: 467,
    markHeight: 729,
  });
  addOutput(outputs, path.join(ASSETS, 'store/app-icon-512.png'), await sharp(appIcon).removeAlpha().resize(512, 512).png(PNG_OPTIONS).toBuffer());
  const playFeature = await compositeMark(markSvg, 1024, 500, {
    background: 'gradient',
    color: COLORS.logo,
    markWidth: 205,
    markHeight: 320,
  });
  addOutput(outputs, path.join(ASSETS, 'store/google-play-feature-1024x500.png'), await sharp(playFeature).removeAlpha().png(PNG_OPTIONS).toBuffer());

  addOutput(outputs, path.join(IOS_ASSETS, 'AppIcon.appiconset/AppIcon-512@2x.png'), await sharp(appIcon).removeAlpha().png(PNG_OPTIONS).toBuffer());
  addOutput(outputs, path.join(IOS_ASSETS, 'AppIcon.appiconset/Contents.json'), toIosAppIconContents());
  addOutput(outputs, path.join(IOS_ASSETS, 'Splash.imageset/SplashLogo.png'), await compositeMark(splashSvg, 125, 196, {
    background: 'transparent',
    color: COLORS.logo,
    markWidth: 125,
    markHeight: 196,
  }));
  addOutput(outputs, path.join(IOS_ASSETS, 'Splash.imageset/SplashLogo@2x.png'), await compositeMark(splashSvg, 250, 392, {
    background: 'transparent',
    color: COLORS.logo,
    markWidth: 250,
    markHeight: 392,
  }));
  addOutput(outputs, path.join(IOS_ASSETS, 'Splash.imageset/SplashLogo@3x.png'), await compositeMark(splashSvg, 375, 588, {
    background: 'transparent',
    color: COLORS.logo,
    markWidth: 375,
    markHeight: 588,
  }));
  addOutput(outputs, path.join(IOS_ASSETS, 'Splash.imageset/Contents.json'), toIosSplashContents());
  addOutput(outputs, path.join(APP_ROOT, 'ios/App/App/Base.lproj/LaunchScreen.storyboard'), toIosLaunchStoryboard());

  addOutput(outputs, path.join(ANDROID_RES, 'drawable/ic_launcher_background.xml'), toAndroidGradientDrawable());
  addOutput(outputs, path.join(ANDROID_RES, 'drawable/splash.xml'), toAndroidSplashDrawable());
  addOutput(outputs, path.join(ANDROID_RES, 'values/colors.xml'), toAndroidColors());
  addOutput(outputs, path.join(ANDROID_RES, 'values/ic_launcher_background.xml'), [
    '<?xml version=\"1.0\" encoding=\"utf-8\"?>',
    '<resources><color name=\"ic_launcher_background\">' + COLORS.gradientTop + '</color></resources>',
    '',
  ].join('\n'));
  const stylesPath = path.join(ANDROID_RES, 'values/styles.xml');
  const currentStyles = await fs.readFile(stylesPath, 'utf8');
  const launchStylePattern = /(?:    <!-- Brand colors are launch\/notification only; regular app surfaces remain unchanged\. -->\n)?    <style name=\"AppTheme\.NoActionBarLaunch\"[\s\S]*?<\/style>/;
  if (!launchStylePattern.test(currentStyles)) throw new Error('Could not find AppTheme.NoActionBarLaunch in values/styles.xml');
  const updatedStyles = currentStyles.replace(launchStylePattern, toAndroidLaunchStyle());
  addOutput(outputs, stylesPath, updatedStyles);
  addOutput(outputs, path.join(ANDROID_RES, 'mipmap-anydpi-v26/ic_launcher.xml'), toAndroidAdaptiveXml(false));
  addOutput(outputs, path.join(ANDROID_RES, 'mipmap-anydpi-v26/ic_launcher_round.xml'), toAndroidAdaptiveXml(false));
  addOutput(outputs, path.join(ANDROID_RES, 'mipmap-anydpi-v33/ic_launcher.xml'), toAndroidAdaptiveXml(true));
  addOutput(outputs, path.join(ANDROID_RES, 'mipmap-anydpi-v33/ic_launcher_round.xml'), toAndroidAdaptiveXml(true));

  for (const density of DENSITIES) {
    const s = density.scale;
    const iconSize = 48 * s;
    addOutput(outputs, path.join(ANDROID_RES, 'mipmap-' + density.name + '/ic_launcher.png'), await compositeMark(markSvg, iconSize, iconSize, {
      background: 'gradient',
      color: COLORS.logo,
      markWidth: Math.round(iconSize * 0.44),
      markHeight: Math.round(iconSize * 0.69),
    }));
    addOutput(outputs, path.join(ANDROID_RES, 'mipmap-' + density.name + '/ic_launcher_round.png'), await compositeMark(markSvg, iconSize, iconSize, {
      background: 'gradient',
      color: COLORS.logo,
      markWidth: Math.round(iconSize * 0.44),
      markHeight: Math.round(iconSize * 0.69),
    }));
    addOutput(outputs, path.join(ANDROID_RES, 'mipmap-' + density.name + '/ic_launcher_foreground.png'), await compositeMark(markSvg, 108 * s, 108 * s, {
      background: 'transparent',
      color: COLORS.logo,
      markWidth: Math.round(34 * s),
      markHeight: Math.round(54 * s),
    }));
    addOutput(outputs, path.join(ANDROID_RES, 'mipmap-' + density.name + '/ic_launcher_monochrome.png'), await compositeMark(markSvg, 108 * s, 108 * s, {
      background: 'transparent',
      color: COLORS.monochrome,
      markWidth: Math.round(34 * s),
      markHeight: Math.round(54 * s),
    }));
    addOutput(outputs, path.join(ANDROID_RES, 'drawable-' + density.name + '/ic_stat_noqueue.png'), await compositeMark(markSvg, Math.round(24 * s), Math.round(24 * s), {
      background: 'transparent',
      color: COLORS.monochrome,
      markWidth: Math.round(15.3 * s),
      markHeight: Math.round(24 * s),
    }));
    // Android 12 masks this drawable: use the 288dp canvas / 192dp safe
    // circle, not the tightly cropped iOS image. Preserve the entire lockup.
    const splashSide = Math.round(288 * s);
    addOutput(outputs, path.join(ANDROID_RES, 'drawable-' + density.name + '/splash_logo.png'), await compositeMark(splashSvg, splashSide, splashSide, {
      background: 'transparent',
      color: COLORS.logo,
      markWidth: Math.round(98 * s),
      markHeight: Math.round(154 * s),
    }));
  }
  addOutput(outputs, path.join(ANDROID_RES, 'drawable/splash.xml'), toAndroidSplashDrawable());

  return {
    outputs,
    staleFiles: [
      'android/app/src/main/res/drawable/splash.png',
      'android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml',
      ...['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].flatMap((density) => [
        'android/app/src/main/res/drawable-port-' + density + '/splash.png',
        'android/app/src/main/res/drawable-land-' + density + '/splash.png',
      ]),
    ],
  };
}

async function run() {
  const checkOnly = process.argv.includes('--check');
  const { outputs, staleFiles } = await buildAssetOutputs();
  const mismatches = [];

  for (const [relativePath, expected] of outputs) {
    const absolutePath = path.join(APP_ROOT, relativePath);
    let actual;
    try {
      actual = await fs.readFile(absolutePath);
    } catch {
      actual = null;
    }
    if (!actual || !actual.equals(expected)) {
      mismatches.push(relativePath);
      if (!checkOnly) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, expected);
      }
    }
  }

  for (const relativePath of staleFiles) {
    const absolutePath = path.join(APP_ROOT, relativePath);
    try {
      await fs.access(absolutePath);
      mismatches.push(relativePath + ' (stale)');
      if (!checkOnly) await fs.rm(absolutePath);
    } catch {
      // A removed legacy asset is the expected state.
    }
  }

  if (checkOnly && mismatches.length) {
    console.error('Mobile brand assets differ from generated outputs:');
    for (const item of mismatches) console.error('  - ' + item);
    process.exitCode = 1;
    return;
  }
  console.log(checkOnly
    ? 'Mobile brand assets are up to date (' + outputs.size + ' files).'
    : 'Generated ' + outputs.size + ' mobile brand assets.');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
