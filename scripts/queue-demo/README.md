# Record three real mobile queue journeys

Run `pnpm demo:queue:all` to generate silent Spanish-captioned `restaurant.mp4`, `reception.mp4`, and `pool.mp4`. Staff is on the left and the customer is on the right, each at 390×844 inside a 1920×1080, H.264, 25 fps composition. Individual commands are `demo:queue:restaurant`, `demo:queue:reception`, and `demo:queue:pool`; the legacy `demo:queue:order` aliases reception.

## Quick path

Existing dependencies, Chromium, and FFmpeg with libx264/drawtext are required. Nothing is installed or downloaded.

```sh
FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe pnpm demo:queue:all
```

Each run uses a fresh private ignored `queue-demo-output/<run>/` directory. Only the final MP4s are shareable after visual review. Keep raw videos, screenshots, browser traces, setup URLs, and recovery tokens private.

## What each video proves

| Chapter | Real actions and evidence |
| --- | --- |
| Main journey | Home → global name search without GPS → direct service result → consent form → waiting fourth → approaching → called with normal service deadline → staff arrival confirmation. Restaurant also releases its table through the UI. |
| Customer alternatives | A completely independent queue. Restaurant changes 2 to 3 guests and terrace to interior. All services yield to a compatible later entry, verify the exchanged order, then cancel through the customer UI. |
| No arrival | Another independent queue, configured to one-minute grace **at creation**. Real staff call, real countdown, real server expiry, and the staff Cancelados/Caducado entry. Restaurant verifies release. |

All confirmed screens and dialogs hold for at least five seconds. Phase evidence waits for the exact current h1 (never a persistent progress label); called evidence also requires a rendered countdown. Exchanged staff rows are scrolled into view and proved fully inside the 390×844 recording viewport before their result hold. The 2–4 minute target is editorial guidance, not a screen-dropping limit. Only idle waiting for real expiration is cut, with an explicit Spanish elapsed-time label; the preceding countdown and subsequent real expired screens remain. Main grace is 5 minutes for restaurant and 2 for reception/pool. No browser clock, customer-state mocks, restaurant selectors in pool, or invented sunbed occupancy are used.

## Isolation and delivery checks

The existing isolated E2E worker uses ephemeral local storage and simulated Geoapify, Resend, and WhatsApp; unmatched outbound requests are rejected. Fixture support entries and authentication happen off-camera. Customer commands, admission, staff advancement, and table release happen through real UI.

- Tests run sequentially, one worker, no retries; normal suites do not collect demos or gain pauses.
- Every chapter uses new staff/customer contexts and an independently detected raw calibration marker. Different recording startup offsets are valid. Synchronization is editorial, not latency measurement.
- `source.json` hashes paths, modes, and contents once. Any source drift aborts the batch.
- Per-service JSON records actual/expected assertions, phases, confirmed moments, chapter clips, and cuts. Raw clips are probed for dimensions and coverage.
- All selected services must pass, all pending outputs must pass FFprobe and **full decode**, and the source must remain stable before any final filename is published. Failures preserve diagnostics without success-named MP4s.
- Directories use 0700 and files 0600. Viewport recording excludes browser chrome; final visual review must still check every action for confidential content and legibility.

## Verify and rollback

Run `node --test scripts/queue-demo/*.test.mjs`, `pnpm --filter @noqueue/e2e check-types`, demo/normal collection checks, and the affected Chromium queue/customer/services/discovery regressions. Inspect representative full-resolution final frames for **every** chapter/action; do not describe that as continuous full-video review.

Two cohesive uncommitted work units are possible: (1) service/chapter evidence plus pipeline and unit tests, (2) opt-in real browser journeys plus fixture/config/commands/docs. Rollback removes `scripts/queue-demo`, `tests/e2e/demo`, `tests/e2e/demo.config.ts`, and the `demo:queue:*` root scripts, or restores their prior versions. No production source, public API, normal-test behavior, credential, deployment, or remote operation belongs to this change.
