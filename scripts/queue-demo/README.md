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


## Adaptive countdown: real wall-clock verification

`pnpm demo:queue:adaptive` first records the three public countdowns (4/8/12),
then runs four independent opt-in restaurant chapters:
protection/re-approach/arrival, fast then slow assignments, offline recovery, and
arrival expiration. Allow approximately 20 minutes plus encoding. The public baseline is recorded
with `tests/e2e/baseline-demo.config.ts`; the remaining chapters use the adaptive
selection in `tests/e2e/demo.config.ts`. The recording
uses four-minute initial cadence, two-minute approach margin, and actual waits.
Neither browser nor server time is mocked. Only FFmpeg accelerates wait interiors
20× afterward; two seconds at the start and three at the end of each idle wait
remain at 1×, as do the five-second confirmed moments and all staff actions.

Use the existing FFmpeg binaries described above. Output includes `resumen.mp4`,
`flujo-completo.mp4`, individual real-time/edited chapters, timestamped screenshots,
per-second UI/API telemetry and read-only SQLite evidence from the isolated worker.
No production files, APIs or real providers are changed. Setup/authentication is
trimmed using per-camera calibration. Test failures retain recordings and are
labelled as incidents, not falsely reported as passing. Review the final frames
and the assertions in `delivery.json` before sharing.

For composition without re-running the real wait:
`node scripts/queue-demo/adaptive-video.mjs compose /absolute/run/directory`.
Production/contract/migration fingerprints must still match the recording.
The exact recording-test sources are archived and hash-verified separately, so
a later selector repair cannot rewrite the evidence from an earlier attempt.
Raw metadata contains local recovery tokens: share only reviewed MP4s and a
sanitized report. The standard three-service demos and default E2E suite exclude
these long-running tests.

The October 11 recording found a brief offline `0:00` caused by flooring positive
subsecond remaining time. The product is intentionally unchanged in this video
verification task. The harness now checks waiting-clock zero samples and preserves
any discovered discrepancy at normal playback speed; see the browser video report.
A failed acceptance check must not be relabelled as a successful product test.

## Automatic assignment cycles (October 24)

```sh
FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe pnpm demo:queue:automatic
```

This opt-in recorder uses `tests/e2e/automatic-demo.config.ts` and a fresh local
worker with `NOQUEUE_E2E_AUTO_REPLACEMENT=true`. Nothing is enabled in production.
Four independent chapters capture the actual mobile UI, staff left/customer right:

1. **Restaurant substitution**: manual group of four; same-size FIFO (including
   a younger group of four ahead of an older group of three); descending 3, 2, 1;
   no candidate; a group of five remains waiting; stopped-cycle detail.
2. **Restaurant concurrent cycles**: independent capacities 4 + 4 + 2; staff
   cancellation and arrival stop only their own cycle; explicit priority for a
   compatible smaller group; restart only through another manual assignment.
3. **Reception**: concurrent check-in/check-out/other; swipe cancellation and
   confirmation; subtype-compatible priority replacement; footer CTA restart.
4. **Bar/pool**: client abandonment versus staff cancellation; pass a called turn;
   priority plus real expiry; passed entry returns to waiting; card assignment and swipe.

The scenarios use pre-enrolled fictional clients via the public API. Every action
shown after calibration is real UI against the real isolated backend. Grace is
configured to **1 minute** for substitution/pool, **2 minutes** for concurrent
restaurant/reception. Clocks are never mocked. Idle wait interiors alone are
accelerated ×20 in `resumen.mp4`; `flujo-completo.mp4` preserves real-time waits.
The right camera switches to the named customer between operations. Recordings
are silent and captioned, matching the original pipeline. Allow ~15 minutes plus
encoding; failures publish no success-named final video.

**Semantics worth noticing:** explicit priority precedes normal size/FIFO, but
never bypasses compatibility or initial capacity. Abandonment by the called
customer continues substitution; cancellation by staff stops that cycle. These
are current product behaviors, not changes made by this demonstration. The user
brief's final footer description was incomplete, so the recording shows the
implemented footer rather than inventing a new one.

Run `node --test scripts/queue-demo/*.test.mjs` and
`pnpm --filter @noqueue/e2e check-types`. The runner requires all four chapters,
coverage events, successful commands/assertions and zero remaining active cycles
before composition. `verification-public.json` is sanitized for sharing;
`delivery.json`, raw JSON, screenshots and traces remain local/private.
This demonstrates the stated branches, **not exhaustive production validation**
(network loss, service closure, feature-disable races and concurrent operators
are covered elsewhere, not claimed by this recording).

### Independent recapture without rewriting evidence

`automatic-video.mjs capture <new-directory> <chapter-id> ...` records and verifies
only the selected chapters (no final video). `assemble <new-delivery-directory>
<chain-source> <parallel-source> <reception-source> <pool-source>` accepts four
explicit source directories, checks every selected chapter passed, verifies each
archived recording harness and identical application fingerprints, then records
SHA-256 provenance before composing. A failed batch can contribute a separately
passed chapter, but its failed chapters are never selected or relabelled.
`compose <delivery-directory>` rechecks this provenance. Always use fresh recording
and delivery directories; original attempts are immutable.
