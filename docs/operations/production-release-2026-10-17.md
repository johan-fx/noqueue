# First production publication — 2026-10-17

## Authorized scope

The user authorized isolated production infrastructure and publication of the web
app/API and landing, **GA OFF and WhatsApp OFF**. They confirmed the ES/EN legal
texts were validated, selected username `admin`, and explicitly authorized reuse
of the staging Geoapify key. No other staging credentials/data were copied.
No push, channel/number transfer, GA activation or email setup was performed.
Cloudflare Network Error Logging remains ON by explicit user decision; it is not
Google Analytics or Cloudflare Web Analytics.

## Deployed resources

Account `fa5fab4df1b0f12c946a3ea47fab96eb`; zone
`a94702dd60416bf895b4f3dd0e753057`.

| Resource | Verified identity/state |
| --- | --- |
| App/API | `noqueue-api-production`, `https://app.noqueue-app.com` |
| App version | `3b906782-cb07-40d2-b470-ee67cca67e42` |
| Landing | `noqueue-landing`, `https://noqueue-app.com` |
| Landing version | `5bd0b6cb-9a08-4ddd-80ce-8e9be4008dae` |
| Previous landing version | `5a5ef0f7-270e-4209-ba53-fb840e31da01` |
| D1 | `noqueue-production`, `aee70f5d-5c30-47ec-bf97-e24bcd3620e8`, EU jurisdiction |
| Queue coordinator namespace | `0b288bc3f48d4dd99ccf4a0dfcb7918c` |
| Queues | `noqueue-whatsapp-production`, `noqueue-whatsapp-production-dlq` |
| R2 | `noqueue-venue-logos-production`, EU jurisdiction, Standard |
| Asset origin | `https://assets.noqueue-app.com`, minimum TLS 1.2, r2.dev OFF |
| Asset header rule | `1be9a8566e96421dae73fbb8d38cab41`, only the production asset hostname |

Both Worker development and preview URLs are disabled. The deployed crons are
`* * * * *` and `*/15 * * * *`; the latter includes the daily 03:00 UTC receipt
cleanup. Registration is verified, not a claim that the first daily cleanup has
already executed. Invocation logs and traces are OFF; safe application logging
remains enabled. Queue storage is not claimed to have EU residency.

All 28 migrations are applied. Final read-only inventory: one admin, zero
organizations, venues, queues or turns. Smoke testing left four synthetic declined
consent receipts (no personal data, no accepted analytics). Normal receipt
retention applies; no public consent lookup was added.

## Security and feature gates

- Both frontend analytics flags are false; measurement IDs are empty. Served
  HTML/JS match the final OFF build manifest, including the self-hosted CMP assets.
- `WHATSAPP_ENABLED`, `PRODUCTION_WHATSAPP_APPROVED` and
  `WHATSAPP_V4_TEMPLATES_APPROVED` are false. No live channel API key or phone ID
  is installed. No WhatsApp was sent; staging's channel is unchanged.
- Independent production auth/encryption/recovery keys and an inert authenticated
  webhook key were installed atomically with the first deployment. No local
  bypass secrets exist in the deployed secret-name inventory.
- `VENUE_LOGOS_ENABLED=true` follows the successful synthetic PNG CDN round-trip:
  HTTP 200, exact bytes, image MIME, nosniff, `default-src 'none'; sandbox`.
  The synthetic object was subsequently removed.
- Private initial credentials are in the ignored local folder
  `reports/production-private` (0700), with files 0600. Transfer the initial admin
  credential and security keys to the client's secure custody; never commit or
  paste their values into chat, issue trackers or logs.
- Email verification remains unconfigured. Username/password sign-in and consent
  do not depend on it; staff email verification requires a verified sender and
  production Resend settings before use.

## Verification evidence

- 27 production preparation/tooling tests and six final actual-bundle OFF browser
  checks pass. Earlier full regression evidence is linked in the launch runbook.
- 43 live app/API checks pass: HTTPS, no-referrer, matching HTML/JS, no injected
  Google/Web Analytics script, health, anonymous staff denial, secure admin
  session, empty venue list, logos feature, sign-out and rejected old session.
- Receipt API verified with synthetic data: both exact production CORS origins,
  no credential permission, 204 and idempotent replay, conflicting payload 409,
  staging-origin denial, strict unknown-field rejection and 1024-byte bound.
- Six live landing resources match local artifacts with CSP/no-referrer. Chrome
  renders the landing, Spanish/English, and the manually opened privacy panel;
  rejecting closes it. No automatic banner is expected while GA is OFF.
- Production Geoapify successfully resolved a public Madrid landmark through
  the authenticated API with a new provision-operation UUID. No venue was saved,
  candidate tokens were not logged, and the test session was signed out.
- Public DNS resolvers 1.1.1.1 and 8.8.8.8 resolve the new app domain. During the
  initial smoke macOS/Chrome retained a negative DNS cache; HTTPS checks used
  the verified public A record with normal hostname/certificate validation.
  The initial publication therefore did not claim an app browser smoke. The
  follow-up below now verifies normal DNS and the production browser flow.
- D1 Time Travel was successfully rehearsed on a disposable EU database, then
  that test database was deleted. Production was never restored. Full SQL export
  is blocked by FTS5; see the recovery runbook.

Evidence in ignored `queue-reports/production/`: `manifest.json`,
`app-deploy.log`, `landing-before.log`, `landing-deploy.log`,
`remote-app-smoke.json`, `remote-landing-smoke.json`, `remote-config.json`,
`remote-geoapify-smoke.json`, `privacy-live.png`. These reports contain no
credential values. The temporary
smoke initially asserted a nonexistent `user.role`; the API's actual contract is
`platformAdmin`. Correcting the smoke assertion resolved it; no runtime change
was needed.

## Outstanding before full operational opening

1. Normal-DNS production app visual/session smoke is now complete. Real
   establishment onboarding/queue/concurrent-write/PWA-update checks remain
   separate operational work. No demo business was created here.
2. Transfer password/key custody, set cost thresholds/alert recipients and verify
   the first daily receipt-cleanup execution. Alert subscriptions and a budget
   were not invented or enabled on the client's behalf.
3. FTS5-compatible encrypted backup and disposable restore are now verified;
   see the recovery runbook. Transfer key/archive custody, agree off-device
   storage and scheduling, and account for the initial tool's explicit size caps.
4. Configure email verification if required. Later WhatsApp cutover and real
   recipient tests need separate explicit authorization and approved templates.
5. Real-Google isolated audit and sequential GA activation remain separate,
   unauthorized steps. Do not enable GA in staging to test them.

The landing intentionally keeps its existing project-in-development wording;
this technical publication is not a public service-opening announcement.

## Rollback

Retain the OFF artifacts and manifest. The app has no earlier production release;
if unsafe, close admissions and publish a reviewed OFF maintenance version rather
than pointing users at staging or restoring a database reflexively. The previous
landing version predates the new privacy interface: restoring it also removes
that interface. Prefer the current validated OFF artifact for analytics rollback.
Neither code rollback nor a new deployment automatically closes existing tabs.

## Follow-up: visual app check and FTS5 backup

Completed on 2026-10-17, without a redeploy or changes to GA/WhatsApp gates:

- Normal DNS/HTTPS now works and the served app HTML/JS still matches the OFF
  artifacts. No hosts override or certificate bypass was needed.
- Chrome desktop: public home ES/EN, empty discovery/search state, manual privacy
  preferences/rejection and Spanish legal information render correctly.
- Initial admin login, dashboard, settings and session after reload passed. A
  second tab saw the same session. Logout in the first tab followed by reloading
  the second returned both to login. The test session was closed.
- The establishment form and real Geoapify address dropdown were inspected;
  selecting a precise public street address showed the confirmation state.
  The form was cancelled without proceeding/saving: no new business/turn/message.
- Bitwarden's inline menu and later "Update existing login" banner temporarily
  blocked automation. The latter offered to update a **staging** credential from
  the production login. Both were dismissed, following the user's instruction
  to take control. No extension setting or saved credential was changed.
- Screenshots: `queue-reports/production/app-public-live.png` and
  `app-staff-live.png`. This is a desktop Chrome smoke, not a claim of a new
  production WebKit/mobile-device regression or a concurrent business write test.
- The FTS5-compatible encrypted archive passed both an initial restore and a
  second restore from the saved archive with **no production source read**.
  All 66 base tables, schema and sequences matched. Local integrity/FKs, D1
  quick-check/FKs and FTS insert/MATCH/rename/delete probes passed. Both runs'
  temporary EU databases were deleted. No production FTS object was modified.
- The final production-tooling suite has **31 passing tests**. The backup is
  currently manual/local with documented size limits, not an off-device scheduled
  service. See the recovery runbook for commands, key custody and boundaries.

No push/commit, application deployment, channel migration, Google activation,
real WhatsApp, email or change to NEL was performed in this follow-up.

## Activation preparation (same day; not a deployment record)

The user subsequently authorized gradual GA4/WhatsApp activation, retaining both
features ON only after their gates pass, and authorized commit/push to main after
local green. This supersedes the earlier "unauthorized" status above. No launch
announcement is part of this release. Use the new production-activation runbook.

- Added explicit release profiles, archived compiled artifacts and independent
  rollback; base production configuration remains OFF. Staging's tracked WhatsApp
  flag is now OFF for the exclusive channel transfer (remote state must be verified
  separately at cutover, not inferred from this file).
- Corrected only the 14 existing production template URL buttons/examples from
  apex to `app.noqueue-app.com`. Fresh provider inventory confirmed all 24 selected
  templates APPROVED, with text/category/order unchanged: 18 Utility, 6 Marketing.
- Channel readback still points to staging with authenticated custom-header delivery.
  Console: Ready/High, 48.17 EUR balance, 250 users/24h, existing auto-recharge ON
  (untouched). No top-up, business verification or subscription change authorized.
- No staging pending/sending rows at readiness inspection. Two historical unknowns
  from 2026-10-11 (queue_joined and delayed, one attempt, no provider ID) are retained
  without retry, assumed delivery or transfer into production. Production outbox empty.
- Fresh encrypted backup: 66 base tables; local restore/integrity passed. Earlier
  disposable EU D1 recovery rehearsals remain documented above.
- Local regression: API 687; product browsers 208 across Chromium/Firefox/WebKit;
  production OFF bundles 6; privacy 36; PWA 8; web 576; contracts 85; landing 5;
  privacy unit 12; production tooling 43. Type checks/lint passed.
- The isolated real-Google audit uses actual archived frontends and local real API,
  with fake messaging and no remote production/staging data requests. Local workerd
  cannot implement `.jurisdiction('eu')`; the test-only wrapper maps EU to the same
  ephemeral namespace. Production jurisdiction enforcement remains unchanged.

Final audit, CI results, release IDs, actual activation and WhatsApp message count
must be appended after execution. None of the preparation bullets claims activation.

### Isolated real-Google gate passed

The complete audit finished successfully against release
`20261017114107624-both-wa-off-91db03`; private evidence
`reports/production-private/google/20261017114718206/audit.json`.
Both origins passed acceptance after real local receipt ACK, rejection/reload,
withdrawal, cross-tab/host isolation, late script, unavailable/read-only storage,
API failure, expiry/revision invalidation, real form join/full-document ticket
boundary, history/reload/restored ticket, normalized venue/search, SPA navigation,
query/language/hash/polling non-duplication, and excluded/error documents.
Every captured Google packet was checked for raw synthetic context, business IDs
and ticket tokens, including repeated URL decoding: zero violations. This proves
that tested tag version/configuration, not every future Google script revision or
real OS crash/restore scenario. No production API/D1 or real WhatsApp was used.
The later tracked staging-OFF configuration does not change the audited web/privacy
sources; fresh production archives are still required before deployment.
