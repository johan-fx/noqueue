# Record the mobile queue-order demo

Run `pnpm demo:queue:order` from the repository root. This opt-in command records the actual Q-BROWSER-ORDER browser flow; it is not included in CI or ordinary Playwright collection. It creates a silent 1920×1080 MP4 lasting 60–90 seconds, with staff on the left and Alice on the right. All three browser contexts are mobile (390×844, touch enabled); Bob is verified in a separate context off-screen.

## Requirements

An existing FFmpeg build with `libx264` and `drawtext`, plus FFprobe, must be on PATH. Alternatively:

```sh
FFMPEG_PATH=/absolute/path/to/ffmpeg FFPROBE_PATH=/absolute/path/to/ffprobe pnpm demo:queue:order
```

On macOS, the basic Homebrew `ffmpeg` build may omit `drawtext`. If the operator has separately authorized and installed `ffmpeg-full`, use its keg-only binaries without changing global links:

```sh
FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe pnpm demo:queue:order
```

The preflight tests capabilities and font rendering before opening a browser. It never installs tools. Missing capabilities stop with a nonzero exit; ask the operator to provide binaries or authorize installation separately. Playwright Chromium and the existing local E2E dependencies must already be available.

## Evidence and privacy

- Each run has a private, ignored `queue-demo-output/<run>/` directory. The final file is `queue-order.mp4`; raw WebM, browser diagnostics, expected/actual assertions, monotonic moments, source HEAD/dirty state/content hash and FFprobe metadata remain alongside it.
- Raw staff recordings contain synthetic login/setup information and local URLs. Do not share the directory. Only the calibrated, trimmed final MP4 is intended for review and sharing after visual inspection.
- Calibration markers are shown before the business flow, detected independently in each recording, then trimmed away. Editorial alignment has a 150 ms validation tolerance; it is NOT latency measurement. Actions and polling remain real-time, without speed-up or cuts. The Spanish captions and simulation disclaimer sit outside the app viewports.
- Setup uses the existing isolated E2E server, random port and temporary state, never the developer database or real messaging providers. No business clock or public API changes are made.
- Failed assertions, missing markers, changed source, unsupported durations or invalid output prevent a success-named MP4. Diagnostics are retained; retries are disabled.

## Verify before sharing

Run `node --test scripts/queue-demo/*.test.mjs` and the existing Chromium queue verification spec. After recording, watch the complete MP4: check both mobile views, readable captions, the staff confirmation, actual position updates, and absence of login/setup/calibration frames. Probe metadata proves dimensions/duration/no audio, not visual quality. Delete private run directories manually when they are no longer needed.

The rollback boundary is the demo command/config/spec/scripts plus the shared helper extraction. The existing scenario keeps the same assertions and gains no demonstration pauses.
