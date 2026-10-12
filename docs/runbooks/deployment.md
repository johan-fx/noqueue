# Deploy the current application to staging

Deploy the web assets and API together with **cloud V4 enabled** at `https://staging.noqueue-app.com`. Staging accepts valid consenting test recipients without an allowlist or an internal template-approval toggle. The operator checks provider approval before creating new turns; approval does not require another deploy. This runbook is a procedure, not evidence that the current source has been deployed or delivered messages.

## Current rollout

1. Complete local verification below. Confirm authorization for the staging destination, operations and the specific Cloudflare/360dialog session or credential before any remote inspection or mutation. Do not discover or reuse ambient credentials.
2. Read the actual staging Worker configuration, secret names, D1 migration inventory and notification backlog. The historical snapshots below are not current truth. Retain existing `PII_ENCRYPTION_KEY`, `PHONE_HASH_KEY`, `RECOVERY_TOKEN_KEY` and auth keys; never regenerate them against existing data.
3. Confirm `D360DIALOG_API_KEY`, `D360DIALOG_WEBHOOK_TOKEN`, `D360DIALOG_PHONE_NUMBER_ID` and the application's required auth/mail/location secrets. The checked-in phone ID is intentionally blank: supply the verified staging channel ID at deployment, never invent it. The current channel is used exclusively for staging; a separate staging number must be assigned before a future production launch. No production routing or multihook architecture is introduced here.
4. Configure the channel callback to `https://staging.noqueue-app.com/api/v1/integrations/360dialog/webhook` with the `X-NoQueue-Webhook-Token` header matching the existing secret. Cloud callbacks must carry the configured phone-number metadata ID. 360dialog supports custom webhook headers; keep authentication intact, never use the sandbox capability route for cloud. Verify authenticated inbound/status reception under the separately authorized provider scope. See [360dialog webhook API](https://docs.360dialog.com/docs/messaging-api/api-reference/webhooks).
5. Capture a staging D1 backup/Time Travel bookmark and deployment/configuration rollback evidence. List migrations and apply **only pending** repository migrations, currently through `0018_venue_configuration_updated_at.sql`, before the new Worker. Do not reset the database. Migration 0004 rebuilds outbox storage by copying existing rows before replacement; later migrations add storage/backfill/search maintenance. Verify the actual pending set rather than trusting the old 0001–0005 snapshot. See `d1-recovery.md`.
6. Before enabling the new Worker, inventory pending notices by ID, version and phase. Existing phase/cycle/revision guards cancel stale notices, but valid pending rows can still send. Cancel only specifically identified pre-cutover pending intents that must not send, through an authorized staging operation; retain their rows, entries, consent and history. Do not mass-delete data, reinterpret V1–V3 snapshots, or reset failed/accepted/terminal, sending or unknown outcomes. Old V4 rows do not freeze catalog layout/name/revision; handle incompatible pending rows explicitly.
7. Build and deploy with `--env staging` and the confirmed owning account. Preserve the verified phone ID and required configuration in this deployment. Checked-in staging selects `APP_ENV=staging`, `WHATSAPP_MODE=cloud`, `WHATSAPP_COPY_VERSION=4`, `WHATSAPP_ENABLED=true`, the correct public origin and all 24 exact V4 bindings. Do not set approval flags falsely true. The old confirmation experiment stays off. `WHATSAPP_ENABLED=false` remains an emergency stop, not a later activation step.
8. Verify health, SPA routes, assets, auth and migrations. Once the operator confirms provider approval/category, test new ES/EN public and staff-created turns with multiple consenting phones, delivery callbacks, signed buttons, selector links and STOP. A rejected template leaves the turn intact and notification failed; ambiguous sends are not retried. Do not claim delivery before real acceptance/callback evidence.

## Historical deployment snapshot

**Status (2026-09-23):** Staging is deployed at
`https://staging.noqueue-app.com`, Worker version
`f1172bb3-208d-460f-a40c-aa222de3b792`. Production remains separate.

The staging D1 `noqueue-staging` has migrations 0001–0005 applied. The initial
`admin` platform administrator was bootstrapped with a Better Auth credential;
the credential is **not** in Git. `BETTER_AUTH_SECRET` is installed as a Worker
secret. No production database or Worker was changed.

Before migration 0005, D1 Time Travel returned bookmark
`0000006f-00000000-000050ef-963e6bb1c1fc3d16ab83e93b58068eb5`.
The preceding Worker version was `4476290c-8163-43e1-b844-675964fcc79d`.
Time Travel restoration overwrites current data, so assess intervening pilot
writes before considering it. See `d1-recovery.md`.

The 2026-09-23 deployment preserved these active staging values:
`WHATSAPP_ENABLED=true`, `CONFIRMATION_EXPERIMENT_ENABLED=true`,
`STAGING_EXPERIMENT_APPROVED=true`,
`STAGING_EXPERIMENT_OPEN_RECIPIENTS=true`, and the existing
`D360DIALOG_PHONE_NUMBER_ID`; `STAGING_CONSENT_APPROVED=false` remains.
That deployment used early pilot defaults. The current staging configuration intentionally
enables the real V4 flow and disables the old confirmation experiment. Read the actual
remote configuration before replacing it; preserve required channel settings, not obsolete pilot activation flags.
Use `--env staging` and the confirmed account ID
`fa5fab4df1b0f12c946a3ea47fab96eb`; never deploy the local default.

## Preflight

```bash
pnpm install --frozen-lockfile
pnpm check-types
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Then confirm the target account/environment, D1 identifier, pending migrations and required secrets. Apply D1 migrations explicitly before deploying the Worker version. Verify `/api/v1/health`, the SPA fallback and observability after deployment.

Native releases are separate: build the web artifact with the target public API origin, run `pnpm mobile:sync`, then archive/sign in the platform toolchain. Never reuse a staging bundle for production.

## Browser updates and missing chunks

The web app uses a **waiting, consented PWA update**, not an immediately activated
service worker. Keep the previous worker and its precached assets in use while a
customer or staff member finishes a form. The update banner can be postponed.
Applying an update is explicit; the worker must refuse forced activation while
other application windows are open. Finish work and close those windows before
retrying. Do not clear browser storage, cookies, recovery links, or all caches as
an update mechanism.

The open-window check is conservative, not an atomic browser-wide lock: a new
window can open between the check and activation. No other window is instructed
to reload; the route recovery remains necessary for that race, cache eviction,
and ordinary network failures. Do not describe this as guaranteeing that a
dynamic import can never fail.

The eager root route error boundary also covers rejected lazy imports. Its reload
button checks for an update and coordinates activation before reloading the same
URL, including query parameters and fragment. Offline/failed checks remain on the
recovery screen with a manual retry: there are no automatic reload loops. Ordinary
application errors must not be presented as confirmed version conflicts, and raw
errors/URLs/tokens must not appear on the recovery screen.

`/assets/*` is Worker-first as well as `/api/*`: a missing asset must return a real,
non-cacheable 404 rather than the SPA HTML fallback. Existing hashed asset MIME,
ETag and cache headers are preserved. Normal navigation (`/q/...`, `/t/...`, etc.)
continues to use the SPA fallback. Keep web assets and the Worker in the same
release; do not publish HTML that points to an incomplete asset set.

Before an authorized deployment, run the focused production-browser PWA suite
(`pnpm --filter @noqueue/e2e test:pwa`) in addition to unit/type/build checks.
It exercises a local release switch with a real service worker. Verify postponed
updates, a second open tab, explicit activation, offline recovery, and a failed
lazy module request. No real turns, messages, or remote deployments are needed.

After an authorized deployment, verify a current JS asset returns JavaScript,
an invented `/assets/missing.js` returns 404 (not HTML), deep links still return
the app, and an already-open client can safely transition to the new release.
Legacy clients already running the former `autoUpdate` bundle cannot acquire
the new recovery UI retroactively: a one-time close/reopen may be needed on this
first rollout. These source changes and tests are **not evidence of deployment**.
