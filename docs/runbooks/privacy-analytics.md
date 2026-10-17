# CookieConsent + GA4 Basic — rollout and operations

## Status / scope

Implemented with **analytics OFF by default**. No production resources, Google property, stream, migration or deployment are created by this change. Production infrastructure remains owned by the launch plan. Native Capacitor, development, previews and staging never qualify, even with copied IDs/preferences. WhatsApp consent and queue/auth storage are untouched.

`@noqueue/privacy` bundles CookieConsent 3.1.0 and its CSS from our own origins. Landing stays static (esbuild, no React). Public access to settings remains available on excluded screens. The web app uses hard-document transitions between allowed and excluded zones: a previously loaded Google tag cannot survive into a ticket document. A 60-second, one-use sessionStorage timestamp preserves “turn created”; it never contains a token. POP handling runs before React Router; pagehide/pageshow suspend and revalidate after BFCache. Do not add another router blocker without integrating this central boundary.

## Build/runtime configuration

### Google account setup (2026-10-17; collection remains OFF)

The Google resources were subsequently created through the Analytics console,
after explicit authorization to accept the Spanish service/data-processing terms:

- Dedicated account `NoQueue`: `412357730`.
- Property `NoQueue — Producción`: `559396149`; Spain time, EUR.
- Landing `https://noqueue-app.com`: stream `16147155522`, measurement ID
  `G-QEVCK0TBCF`.
- App `https://app.noqueue-app.com`: stream `16147105215`, measurement ID
  `G-S905ERLNN9`.
- Enhanced Measurement disabled on both streams. All four optional account
  data-sharing settings off. Google Signals and user-provided-data collection
  not activated. Advertising personalization disabled in all 307 regions.
- Event **and user** retention set to two months; activity-based reset disabled.
  Granular location/device collection disabled.
- No tag installed, advertising links or cross-domain rules added,
  runtime/build switches enabled, DNS changed, or deployment performed.
- Alberto was subsequently granted account-level Administrator access with email
  notification selected, after explicit confirmation at the point of granting it.
  Johan's Administrator access was retained; both entries were verified in the UI.

These IDs are inventory, not activation instructions. The initially blank embedded
Google tag panel was bypassed through the official Google Tags configuration UI
(not by installing a GTM container): landing `GT-KFN5LCN2`, app `GT-KD7844DB`.
The subsequent tag-level review found defaults independent of GA4's disabled
Enhanced Measurement. In both tags, history, scrolling, outbound clicks, forms,
videos and file-download detection were explicitly disabled. User-provided-data
capabilities and automatic personal-data detection were also disabled. Neither tag
has cross-domain conditions. Transmission controls were set to prevent advertising,
behavioral-analytics and diagnostic transmission before the required consent.
Both tags retain no CSS/JavaScript extraction locations, no Universal Analytics
event collection, no automatic assertion of advertising consent, and no console
overrides of cookie or consent defaults. The existing controller remains responsible
for host-only cookies, expiry limited to the remaining consent lifetime, no cookie
renewal, default-denied consent and the analytics-only grant after the receipt ACK.

The mandatory base page-load detector cannot be disabled in this UI: the existing
`send_page_view: false` plus manual sanitized pageviews remain necessary. Console
settings are defense in depth, not a replacement for the no-script-before-acceptance
gate or the real-packet audit below. No live collection test was run or enabled.
See [Google tag settings](https://support.google.com/tagmanager/answer/12131703)
and [manual pageviews](https://developers.google.com/analytics/devguides/collection/ga4/views).

Cloudflare inspection found no production `app` DNS record or production
app/API Worker among the connected Workers. The production receipt API remains a
release prerequisite. Cloudflare Web Analytics initially used automatic injection
excluding EU visitors. On explicit user instruction it was changed to **Disable**
for `noqueue-app.com`, saved and verified after reload on 2026-10-17. No DNS, Workers
or security settings were changed. Legal-copy approval remains pending.

| Surface | Environment | Enable switch | Stream ID |
|---|---|---|---|
| Landing | `LANDING_APP_ENV=production` | `LANDING_ANALYTICS_ENABLED=true` | `LANDING_GA4_MEASUREMENT_ID=G-…` |
| Web app | `VITE_APP_ENV=production` | `VITE_ANALYTICS_ENABLED=true` | `VITE_GA4_MEASUREMENT_ID=G-…` |

Omitted values are OFF. These variables are hashed in Turbo's build cache. Runtime additionally requires HTTPS, exact origin (`https://noqueue-app.com` or `https://app.noqueue-app.com` respectively), web not native, an allowed screen, writable localStorage, valid revision/expiry and an acknowledged acceptance. Web venue/queue/discovery screens must report successful loading; initial errors are not measured. No query-string/debug bypass exists. To disable, rebuild/redeploy with the relevant enable switch `false`; existing open documents require reload/update delivery, so use a revocation/response plan as well as the build switch for an incident.

The API requires `APP_ENV=production` and `PUBLIC_APP_ORIGIN=https://app.noqueue-app.com`. It accepts CORS only from those two production origins. Endpoint: `POST /api/v1/privacy/consents`; credentials omitted, no referrer, no-store. Landing activation **depends on this API being ready**.

## Decisions and failure behavior

- Necessary + optional analytics only, ES/EN, equal accept/reject buttons; no advertising category.
- Authoritative preference `noqueue.privacy.v1` and CMP UI state `noqueue.cookieconsent` in localStorage, independently per origin. Expiry 180 days from a choice, not a visit; incompatible revisions invalidate it. CMP state alone can never activate GA.
- Each choice gets a UUID decision ID. Same consent UUID is reused only within the valid local choice period. Only server `204` acknowledges acceptance. The backend receipt is pseudonymous, not anonymous.
- Receipt payload: decisionId, consentId, revision, locale, analytics. Server adds permitted origin and receipt time. No arbitrary properties, URL, token, user, venue, phone, IP or UA. No links to business tables.
- Rejection/withdrawal stop immediately, clear only host-only `_ga` / `_ga_*`, and cancel any pending view. Auth/session/service storage is preserved. Cross-tab storage events revalidate consent. If storage becomes unwritable, the current document fails closed.
- Persist only the current pending receipt (no offline event queue). Three attempts maximum per decision, nominal backoff 5s then 30s, request timeout 5s. Reload may retry within the remaining attempt budget. New decisions supersede pending ones and late ACKs cannot restore an old acceptance. After exhaustion, analytics stays off; users can reject then explicitly accept again to make a new decision. No service operation waits for receipt delivery.
- No historical pageview replay. During a tag download only the current allowed page is retained. On navigation it replaces any pending page.

## GA console checklist — mandatory before enablement

1. Create one new GA4 property, two web streams (landing/app); use different real measurement IDs. Do not configure GTM or a Firebase Analytics SDK.
2. **Disable all Enhanced Measurement**, especially history changes, site search, forms and outbound clicks. `send_page_view: false` alone is insufficient. Leave automatic event creation / URL-derived rules off.
3. Disable Google Signals, advertising personalization, ads links, User-ID, cross-domain measurement/linker and user-provided-data collection. Do not configure key events/conversions.
4. Set user/event retention **2 months**, disable “reset on new activity”; review account data-sharing settings and restrict access.
5. JS uses only `analytics_storage=granted`; `ad_storage`, `ad_user_data`, `ad_personalization` remain denied. Basic mode loads nothing before acceptance. `cookie_domain: 'none'`, `cookie_update: false`, expiry limited to remaining consent. No campaign attribution passed from query strings.
6. Capture and review actual production-tag requests (including automatic session/user-engagement events) with synthetic inputs before broad activation. Every request must contain only sanitized context, never the current raw URL, query, hash, referrer, search, token or business ID. Mocked automated tests prove our gate/payload, **not the behavior of Google's mutable remote script or console settings**. Do not enable if this verification fails.

Allowed manual pageviews: landing `/`; app `/`, `/search`, `/v/:id` → `/v/venue`, `/q/:id` → `/q/queue` (demo-venue, demo-queue and confirmation-experiment seeds excluded). Static titles, empty referrer. No other events are instrumented; Google's technical events must inherit the same sanitized context. Changing only language/search/hash/polling is not a visit. Never add generic router/location logging to the transport.

## Data / legal / platform prerequisites

- Apply migration `0028_privacy_consents.sql` through the normal reviewed deployment flow, before enabling either frontend. No remote migration was run here.
- Receipt retention **13 calendar months is an initial product choice requiring legal validation**, not a claimed statutory requirement. Review legal bases, controller details, Google processing terms/international transfers, rights process and the relationship to service/WhatsApp notices before publication/activation. Current bilingual text is implementation copy, not a compliance certification.
- Revision archive lives in `docs/privacy/revisions/1/` (ES/EN legal text, consent UI source and configuration). Preserve each published revision. For incompatible purposes/providers, archive a new revision, update contract/CMP revision and coordinate API/frontend deployment; old acceptance cannot authorize the new policy.
- D1 indexed receipt cleanup runs daily at 03:00 UTC through the existing 15-minute schedule, in batches of 1000 (budget 900 batches, above current daily admission ceiling). Rate-bucket cleanup runs each 15 minutes in batches of 2000 (up to 20). Ensure this cron exists in production. Alert on `privacy_*cleanup_failed` and `privacy_*cleanup_backlog`; inspect counts only, never export receipt bodies to logs. Retention for platform backups/access logs must be configured separately.
- API body <=1024 bytes, strict JSON/schema, idempotent decision IDs (conflicting reuse →409), per-consent 10/min and aggregate 600/min budget. No IP-based key is stored. These are initial protective bounds, not a traffic forecast: monitor aggregate 429s and tune with cleanup budgets if needed. Configure Cloudflare edge/WAF limits to protect against invalid requests, ID rotation and replay floods before public enablement; CORS is not authentication/abuse protection. Replayed known identical receipts return204 without new writes.
- Do not log request bodies or enable session replay. Cloudflare hosting/security logs can independently process connection metadata; review their retention and access. Verify Cloudflare Web Analytics/Zaraz/other injected tags are not independently active. No broad CSP wildcards or Google preconnect are added.

## Verification / delivery sequence

1. Ship API + migration + local CMP/UI with flags OFF.
2. Local/staging: confirm zero Google network, zero GA cookies; regress queue creation/recovery, WhatsApp, auth, language, keyboard/focus and PWA updates.
3. Configure Google and validate legal/platform prerequisites above.
4. Production deploy OFF; verify receipt API/CORS/idempotence and no automatic third-party injection.
5. Enable landing only, inspect actual packet payloads using synthetic URLs. Then enable app and repeat ticket direct/join/back/forward/BFCache checks. Do not enable staging for testing.
6. Incident: stop activation, disable the relevant switch, deliver reload/update, verify no continued traffic and fix before reactivation. Never delete session/ticket storage as a rollback.

Commands (local only):

```sh
pnpm --filter @noqueue/privacy test
pnpm --filter @noqueue/api exec vitest run src/features/privacy/routes.test.ts
pnpm --filter @noqueue/landing test
pnpm --filter @noqueue/web test
pnpm --filter @noqueue/e2e test:privacy
pnpm --filter @noqueue/e2e test:pwa
pnpm check-types
```

Privacy Playwright runs Chromium/Firefox/WebKit, intercepts **all** traffic to production-named fixture origins, uses real privacy/controller/router code with fake product screens, API receipts and Google script. It makes no Google/production requests. Real product flow regressions use the existing local API E2Es separately. Browser restoration test includes actual back/forward and a synthetic persisted page lifecycle; full OS tab/session restore and real native builds remain device smoke checks.

Reference: [GA4 manual pageviews and history measurement](https://developers.google.com/analytics/devguides/collection/ga4/views), [CookieConsent configuration](https://cookieconsent.orestbida.com/reference/configuration-reference.html).


## Implementation verification (2026-10-16)

- Shared privacy unit tests: 12 passing; contract suite: 85 passing (includes browser/server strict-validator parity).
- Web unit suite: 572 passing; landing: 5 passing, including <20 KB gzip budget for the local JS entry (about 14 KB; CSS about 6 KB).
- Privacy Playwright: 36 passing across Chromium, Firefox and WebKit; dark-mode mobile panel visually inspected, equivalent accept/reject styles and keyboard verified.
- Existing product E2Es: customer queue, discovery and WhatsApp, 30 passing across the three engines. Existing PWA suite: 8 passing (desktop and Pixel).
- Privacy API: 8 passing, including CORS, strict fields/size, concurrency/idempotence, rate budgets and multi-batch calendar retention. Staff/customer/WhatsApp API integration subset also passed (98 tests including the earlier five privacy cases).
- Workspace typecheck passed. Web lint: no errors; two existing warnings in stepper and CreateEstablishmentDrawer.
- Initial broader staff E2Es exposed three failures and a WebKit provisioning timeout. These were subsequently resolved: the user-creation fixture now selects its required service; configuration editors obtain a fresh, serialized versioned snapshot without making catalogue polling write; the WebKit address helper focuses the offscreen input through a normal click before filling. The complete staff suite then passed (30 tests), with stale-write rejection preserved.
- These are local results, not staging/production validation. Google is mocked. Actual GA console settings, live technical events, OS session restore/native-device smoke tests, legal approval and Cloudflare injection audit remain release gates.

### Follow-up: session resilience and CI diagnosis (2026-10-16)

- CI run `38911831474` had 31 browser failures. Thirty were outdated checks: 21 assumed QR screens had no links (the permanent privacy link is now required); three assumed the mobile activation switch was above the fold before the venue address block existed; three expected superseded paused-list wording; three omitted the configuration-context endpoint in strict mocks. Assertions now match the intended contract while retaining link restrictions, responsive checks, rejected admissions and exact mock request counts.
- One failure exposed a real initialization race: a first dashboard poll could initialize the estimator after the opening snapshot and invalidate its version. The public coordinator RPC now finishes that initialization inside its serialized operation before returning the snapshot. A deterministic regression fails before the fix and passes afterwards; two genuinely concurrent commands still yield one success and one `409`.
- The staging session recovered without clearing cookies or changing credentials. The original Chrome connection stall has no proven root cause. A real UI resilience defect is fixed separately: `/staff/me` now has a 15-second abortable check and explicit read-only retry; late responses are ignored, StrictMode/unmount cleanup cancels requests, and a genuine `401` still redirects to login.
- Local follow-up validation: API 658 passing, web 576 passing, focused browser regressions 58 passing in Chromium/Firefox/WebKit, typecheck and lint passing (two pre-existing lint warnings). Tests run in isolated copies without stopping the user's local development server.
- Privacy regressions: 36 passing; PWA transitions: eight passing; queue verification harness: 11 passing. An additional parallel full run exposed a Firefox test synchronization error: it called `focus()` on the still-disabled options button after seeing the active-list label. Its trace confirmed the disabled state; the keyboard test now waits for enabledness and verifies focus before Enter, without changing the UI lock.
- Staging remains analytics-disabled. Production and real GA activation are not part of this repair; all legal/platform release gates above still apply.

### Local test transport

The follow-up CI resolved the original 31 failures but exposed two independent
HTTP 500s from Wrangler's local ProxyWorker (`Network connection lost`), not
application conflicts. A minimal Worker with no NoQueue code reproduced 28/384
failed requests through that proxy versus 0/384 through direct runtime dispatch,
with no retries. This matches the upstream [local keep-alive race report](https://github.com/cloudflare/workers-sdk/issues/14641).

`dev-e2e.mjs` now uses Wrangler's public `createTestHarness` and
`getWorker().fetch` behind a loopback-only Node HTTP adapter. The Worker, assets,
D1 migrations, Durable Objects and fail-closed provider mocks remain real;
storage remains isolated and ephemeral. Neither `harness.fetch()` nor its public
listening URL is used for browser traffic, because those still traverse the
affected proxy. Worker-first paths come from the actual `assets.run_worker_first`
configuration; other paths use the real ASSETS binding and its SPA fallback.
Unsupported route pattern shapes fail at startup rather than silently changing
the routing contract. The adapter preserves request bodies, origin, cookies,
idempotency keys, redirects and error statuses. It never retries a request or
turns a conflict into success. These changes apply only to the local test server,
not staging or production. Response/request `Connection: close` experiments did
not resolve the reproducer and were discarded.

Local verification of this transport: 14 harness tests passed, the full product
suite passed with 207 tests and one existing skip across Chromium/Firefox/WebKit
(three workers, zero retries), and the formerly intermittent assignment case
passed all 15 repetitions (five per engine, zero retries).

The first remote run with this transport also passed all 207 product tests and
all 658 API tests. Its strict aggregate report correctly still rejected two
scenarios whose assertions did not record their evidence, plus the existing
Firefox logo skip. The learning/progress assertions now use the evidence helper
(which still asserts equality), and the full logo/permission test runs in Firefox
with touch enabled but without its unsupported `isMobile` emulation option.
The report's rejection of missing evidence, skips, failures and flaky tests is
unchanged. Focused validation: eight API scenarios with a passing evidence
verdict, and all six logo tests across the three engines with zero skips.

A subsequent full local run passed all 208 browser tests, but exposed a separate
API test's wall-clock assumption: a 31-request burst can cross a minute boundary
and legitimately use two rate-limit buckets. The test now controls `Date.now`
only within that burst, asserts 30 successes then a `429`, advances one
millisecond into the next minute and asserts recovery. Its clock spy is restored
in `finally`; timers, I/O and the production limiter remain unchanged. The full
staff API file passes all 77 tests with this boundary regression.

### Staging smoke after the session repair (2026-10-16)

- Application commit `6dfd6de` was deployed only to staging, preserving all 60
  live bindings. Its build explicitly uses `staging`, analytics disabled and an
  empty measurement ID. Production was not deployed.
- The existing authenticated session survived the PWA update. A deliberate
  offline session-check failure displayed the recovery UI; restoring the network
  and choosing the read-only retry recovered access without clearing the session.
- One explicitly authorized test turn was created, recovered through reload and
  back/forward navigation, then cancelled. Provider callbacks confirmed both
  `queue_joined` and `cancelled` delivered, with one attempt each. Delivery is not
  a claim that the messages were read or their links opened.
- The browser network capture contained no external requests during that flow
  (0 of 69 requests after excluding same-origin and browser-extension traffic).
  No recipient, recovery token or personalized URL is archived here.
- Only the test turn was cancelled; the pre-existing turn was left untouched.
  The test list ended paused, with admissions closed, rather than being forcibly
  reset to its initially inactive state.

## Production preparation follow-up

See [production launch](production-launch.md) for the local guards, fresh database
initialization, WhatsApp production policy and the separately authorized remote
phases. `pnpm production:build` always builds both frontends with GA OFF and
creates a local artifact manifest; it never provisions or publishes. Do not treat
that build, the mock-Google tests or the preconfigured console as a completed
live-packet audit. Infrastructure, legal sign-off and the first OFF publication
were completed on 2026-10-17; see [the release record](../operations/production-release-2026-10-17.md).
The channel cutover, real-tag isolated audit and sequential landing/app activation
remain pending. Cloudflare Network Error Logging is intentionally retained by
explicit user decision; this is separate from disabled GA/Web Analytics and is
not evidence of zero external technical telemetry.
