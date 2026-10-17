# First web production launch — gated, GA OFF

## State and authorization

Production infrastructure and the first **GA-OFF / WhatsApp-OFF** publication
were explicitly authorized and completed on 2026-10-17. See the
[release record](../operations/production-release-2026-10-17.md) for resource IDs,
versions, evidence and outstanding operational checks. Production D1 is no longer
a placeholder. Root landing remains `noqueue-app.com`; web/API share
`app.noqueue-app.com`. Native/store releases remain separate.

The user approved the published ES/EN notices, username `admin`, and reuse of only
the staging Geoapify credential. Authentication/encryption keys are independent.
No WhatsApp channel migration, GA activation, push, or email setup was authorized
by this publication. Later activation/cutover still requires explicit approval.
CI validates/builds but contains no deploy job; never deploy the top-level local
configuration or silently reuse staging credentials.

## A. Local release evidence

From the repository root:

```sh
pnpm production:check
pnpm test:production
pnpm check-types
pnpm lint
pnpm --filter '!@noqueue/api' --filter '!@noqueue/root' -r --if-present test
QUEUE_BROWSER_WORKERS=3 node scripts/queue-verification/run.mjs --all
pnpm --filter @noqueue/e2e test:privacy
pnpm --filter @noqueue/e2e test:pwa
pnpm production:build
pnpm --filter @noqueue/e2e test:production
```

Run `production:build` **last**: other tests/builds may replace dist directories.
It explicitly builds web/landing with production environment, same-origin API,
public/QR links pinned to `https://app.noqueue-app.com`,
both analytics flags false and empty measurement IDs, without Turbo reuse. It
bundles the API via Wrangler `--env production --dry-run`. No migrations or
remote changes run. The production browser smoke loads these actual bundles at
intercepted production hostnames and blocks every network request, including
Google; it verifies the OFF behavior even with a copied acknowledged grant. `queue-reports/production/manifest.json` fingerprints all
three output trees and the Worker source/config/contracts/lockfile. Deploy refuses
modified artifacts or source. This is a provenance/accident guard, not a signed
artifact security boundary. Do not hand-edit the manifest.

Production WhatsApp admission and transport require all of:
`APP_ENV=production`, exact `PUBLIC_APP_ORIGIN=https://app.noqueue-app.com`,
cloud mode, copy version 4, enabled channel, nonempty channel ID/API key,
`PRODUCTION_WHATSAPP_APPROVED=true`, `WHATSAPP_V4_TEMPLATES_APPROVED=true`,
and the exact catalogue bindings. Staging approvals/allowlists cannot authorize
production. Those three booleans ship **false**. Historical V1–V3 recipients are
not expanded; STOP, authenticated action results, unknown outcomes, retry limits,
snapshots and coordinator concurrency guards are unchanged.

The catalogue's production URL-button origin is now the app host. Inspect the
provider's actual approved template bodies/buttons, not just their names: old
production templates may still target the apex. Update/re-register and wait for
approval as needed before setting either approval flag. Shared no-URL templates
remain shared, with 24 bindings per environment.

### Local verification — 2026-10-17

- Full API: **687 passed**; product browser suite: **208 passed**, zero retries,
  Chromium/Firefox/WebKit. Strict report:
  `queue-reports/2026-10-17T09-38-01.659Z-47816/index.html` (`PASSED`).
- Web unit 576, contracts 85, privacy unit 12, landing 5, production preparation
  24 at initial preparation (27 after remote-bootstrap/deploy tooling fixes); privacy browser 36 and PWA 8 passed. Types/lint passed (two existing lint
  warnings). Android native compilation is outside this web release verification.
- Final `production:build` and six actual-bundle OFF browser checks passed.
  All requests were intercepted: no production or real Google traffic. The
  generated manifest fingerprints the final OFF artifacts, not earlier E2E builds.
- Updated old production fixtures that incorrectly used staging approval; fixed
  ambiguous called-state heading selectors and awaited address-result rendering
  before checking viewport geometry. No concurrency or idempotency assertion
  was removed. Focused heading and logo flows each passed nine repetitions.
- This is **local evidence**, not a GitHub CI run or production certification.
  Remote release and recovery evidence is recorded separately below; provider
  cutover and the real-Google audit remain pending separate authorization.

## B. Separate infrastructure (repeatable procedure)

1. Confirm account `fa5fab4df1b0f12c946a3ea47fab96eb`, operator permissions,
   budget/alerts and ownership with the client. Inventory remote resources before
   creating anything; reuse only verified production resources, never staging.
2. Provision `noqueue-api-production`, D1 `noqueue-production` in EU jurisdiction,
   its own `QueueCoordinator` namespace (application uses EU jurisdiction),
   queues `noqueue-whatsapp-production` and `noqueue-whatsapp-production-dlq`,
   and EU R2 bucket `noqueue-venue-logos-production`. Queue storage does not gain
   an EU residency guarantee from D1/DO settings.
3. Record the actual D1 ID in the production binding. Associate the app custom
   domain and `assets.noqueue-app.com`; verify TLS. Keep workers.dev and previews
   disabled; disable public r2.dev and apply the logo security headers from
   `venue-logos.md`. Enable logos only after the bucket/domain smoke succeeds.
4. Install independently generated `BETTER_AUTH_SECRET`, `PII_ENCRYPTION_KEY`,
   `PHONE_HASH_KEY`, `RECOVERY_TOKEN_KEY` and the authenticated webhook secret.
   Back up keys securely: later rotation must not strand existing encrypted data.
   Configure only authorized provider credentials. The OFF release installs
   `GEOAPIFY_API_KEY`, but no phone-number ID/channel API key or email settings.
   `AUTH_EMAIL_API_KEY` and verified `AUTH_EMAIL_FROM` are needed only when enabling
   staff email verification. Channel credentials belong to the later cutover.
   Do not install local/pilot bypass secrets in production or put secrets in vars.
5. On the **new** D1 apply the current complete migration inventory (0001–0028 at
   preparation time). Verify actual pending/applied names; do not import staging.
   Historical migrations create demo rows; initialization below removes only
   unused exact seeds, without editing those migrations. After explicit remote
   authorization, use `pnpm --filter @noqueue/api exec wrangler d1 migrations list DB --remote --env production`,
   review the list, then `pnpm --filter @noqueue/api exec wrangler d1 migrations apply DB --remote --env production`
   with the verified account/token. Never use the top-level DB binding.
6. Initialize the administrator before accepting traffic or running maintenance
   against the new DB. Keep business admission closed and WhatsApp off.
7. Configure both `* * * * *` and `*/15 * * * *`. The latter cleans privacy rate
   buckets and, at 03:00 UTC, receipts older than 13 calendar months. Do not copy
   staging's one-cron override or its historical metrics timestamp. Production
   has no staging cron-recovery fallback. Internal metrics capture is separate
   from GA; leave its dashboard off until two genuine cuts are verified.

### Initial administrator and seed removal

The local `auth:bootstrap` script remains local-only. The separate production
script requires an explicit matching database ID, account and API token, plus
`--apply --confirm-empty-production`. Password is read only from stdin (15–128
characters); use a password manager/secure secret source, never a literal in
shell history, process arguments, documentation or chat.

```sh
# NEW EMPTY DATABASE ONLY; do not repeat to reset the existing admin.
# Account/token supplied securely in env.
# Feed stdin from an approved secret source; do not paste a password into argv.
pnpm --filter @noqueue/api auth:bootstrap:production \
  --apply --confirm-empty-production --database-id <VERIFIED_PRODUCTION_D1_UUID> \
  --username <INITIAL_USERNAME> --name '<ADMINISTRATOR_NAME>'
```

The script checks the real table inventory. A single INSERT with an AFTER trigger
asserts that there is no pre-existing business/account/activity data, deletes
only demo queue/experiment/venue/organization seeds, and creates the credential.
Any failure rolls back that entire INSERT, including deletions. Unknown nonempty
tables fail closed. Initial email remains an unverified alias; no false email
verification is performed. A repeat for an existing exact unbanned platform admin
with one credential is a no-op, not a password reset or privilege upgrade.
A different existing account or a used demo blocks initialization.

SQL is sent directly to the D1 query API in memory and an HTTPS request body;
no SQL/password/hash is placed in argv, temporary SQL files or CLI diagnostics.
Provider/network errors are sanitized. Wrangler `d1 execute --file --json` is
**not** a replacement: it uses the import path and does not return SELECT rows.
An interrupted process may leave an `initial_admin_*` trigger; inspect and remove
that exact leftover after checking the operation outcome. Never retry by
resetting the DB or deleting business data. Keep the first credential in the
client's secure custody and verify login before onboarding establishments.

## C. First publication: GA and WhatsApp OFF

Before publication, obtain legal approval of the actual ES/EN notices: controller
identity, providers, transfers, rights, retention and WhatsApp/service purposes.
13 months is a product choice, not a claimed statutory period. Preserve revision
archives; incompatible changes require coordinated API/CMP revision changes.

Verify backups/Time Travel and rehearse recovery on a disposable database. Time
Travel restores the selected database in place; do not rehearse on live data.
Native full SQL export fails because D1 cannot export this FTS5 virtual-table
database. A bounded encrypted logical backup and disposable restore now pass;
do not drop the active search table to force native export. Agree off-device
custody/scheduling and review the size limits in `d1-recovery.md`.

After resources and approvals are verified, rebuild and review the manifest;
then the separately authorized first API publication uses:

```sh
pnpm production:check --provisioned
pnpm production:build
pnpm --filter @noqueue/api run deploy --env production --confirm-production \
  --secrets-file /ABSOLUTE/PRIVATE/worker-secrets.json
```

The optional first-deploy secrets file must be a regular 0600 JSON file. Its
allowlist accepts independent security keys and explicitly authorized Geoapify/
paired email settings, never feature flags, a live WhatsApp API key or local
bypasses. Wrangler receives it atomically with the initial deployment. Keep its
folder 0700, gitignored, and transfer key custody to the client securely. Supply
account/token through the approved CLI authorization without printing values.
`--env-file /dev/null` prevents unrelated dotenv auto-loading.

This wrapper is intentionally for the initial OFF release. It cannot silently
activate WhatsApp or GA. Later operational activation requires its own reviewed
configuration change/build/deploy procedure, not bypassing failed preflight.
Publish the matching landing artifact only after the receipt API is available,
with `LANDING_ANALYTICS_ENABLED=false`. Do not add Google snippets/GTM/Zaraz.

Verify health, login, role boundaries, same-origin API, permanent privacy links,
ES/EN, CSP/no-referrer, no provider injection, and zero Google requests/cookies.
`POST /api/v1/privacy/consents` can be checked directly with synthetic UUIDs:
204 + idempotence, conflicting reuse 409, forbidden origins 403, no credentials,
strict body/size validation and limits. With the frontend flag off the banner is
not auto-shown and UI choices do not send receipts until eligibility is enabled;
this is not a missing API deployment.

Configure edge abuse protection for this endpoint (CORS is not authentication),
without broadly caching authenticated API responses. Review access-log retention
and prevent token-bearing URLs/bodies from being captured. Keep invocation logs
and traces off; application errors expose only safe diagnostic labels/counts.

## D. WhatsApp cutover and functional release

The existing number moves to production. Staging may remain without real
WhatsApp until another number is assigned; do not add multihook routing.

1. Obtain explicit channel-cutover authorization. Verify provider ownership,
   phone metadata ID, credentials and approved ES/EN templates with app URLs.
2. Stop staging admissions/sends in a controlled window. Reconcile its pending,
   sending and unknown outcomes; record the exact disposition of pending jobs.
   Do not mass-delete, replay historical messages, or move staging outbox rows.
3. Set the authenticated channel webhook to
   `https://app.noqueue-app.com/api/v1/integrations/360dialog/webhook`, with
   `X-NoQueue-Webhook-Token` matching production. Keep staging disabled.
4. Review the production config diff and set the production approval/template
   flags and `WHATSAPP_ENABLED=true` only now. Record the deployed config/version;
   GA stays false. Test callbacks/deduplication before public admissions.
5. With an explicitly authorized recipient, validate join/recovery/cancellation,
   delivery callbacks, links and authenticated actions/STOP; do not log tokens or
   the recipient. Verify two-tab stale-write rejection, PWA/session recovery,
   address selection in WebKit, language, keyboard and responsive layouts.
6. Onboard real establishments manually and open only approved establishments.
   If cutover fails, keep admissions/sends closed; never run both environments
   against the number or blindly replay ambiguous outcomes.

## E. Google audit and later activation (not run by CI/local build)

Existing account/property/IDs and approved settings are inventoried in
`privacy-analytics.md`; do not recreate them. Cloudflare Web Analytics is disabled
and Zaraz showed no configured tools at review time. Recheck actual rendered
responses at publication; dashboard state alone is not network evidence.

Before enabling visitors, use an isolated browser profile/context with service
workers blocked and production-host requests intercepted to an isolated local
copy of the **real** production web/landing bundles and local API with synthetic
D1 data. No app/receipt request may reach production or staging. Use an isolated
build output, not the OFF deployment artifacts. Set real stream IDs only for this
explicitly authorized audit; pass only the exact Google script/collection hosts,
and block every other unexpected external destination. Do not persist browser
state or use real users, addresses, phone numbers or capability tokens. Include
unique synthetic sentinels in path/query/hash/search and scan decoded request
URLs, bodies and referrers for leakage. This setup is a future manual audit,
not the existing fake-screen/mock-Google regression suite.

The local API must acknowledge the receipt before Google starts. Inspect actual
script and technical-event traffic across accept/reject/reload/withdrawal,
API failure/blocked storage/delayed script, cross-host/cross-tab behavior, and
public→ticket→back/forward/BFCache/tab restore. No raw URL, query, fragment,
search, token, business ID or credential may reach Google; only allowed manual
pageviews with normalized paths/static titles/empty referrer. Recheck console
Enhanced Measurement, history detection, Signals/ads/user-data and retention.
Failing any condition blocks activation; mocked tests cannot waive this gate.

After legal/technical sign-off and explicit activation authorization, enable
landing `G-QEVCK0TBCF` first, inspect production traffic, then app
`G-S905ERLNN9`. Staging/previews/local/native remain ineligible. Do not instrument
conversions, staff, auth, kiosks or individual turns.

Rollback: retain the last OFF artifact/config and rebuild/redeploy OFF if an
incident occurs. Existing documents require safe reload/PWA update delivery;
this is not an instantaneous global kill switch. Do not clear session/turn data.
Monitor aggregate receipt 429s/errors, cleanup failures/backlog, queue/DLQ lag,
provider outcomes and costs without collecting sensitive URL/body data. A remote
GA emergency switch is explicitly outside this first release.

Activation after the initial OFF release: see [production-activation.md](production-activation.md).
