# Mobile brand assets

The two SVGs in this directory are the unmodified Figma vector exports used as
the single source of truth:

- noqueue-mark.svg — approved app-icon logo master, Figma file
  Y4yqqmDdJ0q1VAgA8EQsi6, node 1863:50820.
- noqueue-splash.svg — approved static splash logo, Figma file
  Y4yqqmDdJ0q1VAgA8EQsi6, node 1894:11467.
- Related logo-background variants were reviewed in node 1854:32094; the
  swatches were reviewed in node 1854:32081.

Both masters contain the complete 13-path NOQUEUE lockup. Keep every path:
there is no NQ-only crop or reconstructed mark in the generated assets.

## Render decisions

- The app icon uses the logo's Figma navy #1F2937 over the approved vertical
  gradient from #E1E1E0 to #B7B7B7. The Figma background layer is marked
  “Do not export”; the gradient is recreated in the generator rather than
  extracted as an asset.
- iOS/Android launch screens use the static logo on the brand light background
  #E1E1E0. The Android 13 adaptive icon includes a white alpha-only
  monochrome layer, and ic_stat_noqueue is a white alpha-only notification
  mask. Both preserve the full 13-path lockup.
- Android adaptive foreground stays navy, distinct from the white monochrome
  layer. Both fit the 66dp safe circle on a 108dp canvas (34×54dp bounds).
- Android 12 splash uses a transparent 288dp square canvas and a uniformly
  scaled 98×154dp mark inside the 192dp safe circle. The former tightly
  cropped iOS-sized bitmap was visibly clipped on the physical Samsung
  Android 12 launcher. iOS keeps its independent 125×196pt logo.
  See https://developer.android.com/develop/ui/views/launch/splash-screen.
- The splash SVG export contains group opacity 0.5, the motion's initial
  value. For the approved static splash, the generator removes that opacity
  only from an in-memory SVG render copy, yielding final opacity 1. The
  source SVG remains untouched; tests verify both source provenance and the
  opaque generated mark.
- Store exports are static brand graphics only: a 512×512 app icon and a
  1024×500 Google Play feature graphic with no fabricated app screen or
  promotional claims.

## Regenerate and verify

From this app directory, run:

- pnpm assets
- pnpm assets:check
- node --test scripts/mobile-assets.test.mjs

The generator is deterministic and writes only the native/store brand asset
outputs listed in scripts/mobile-assets.mjs. The --check mode is read-only
and returns non-zero if any output differs or obsolete launcher/splash
resources remain.
