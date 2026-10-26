# Staging admissions without WhatsApp

This is a backend-only, explicitly enabled test mode. It does not change the
forms, phone/consent requirements, kiosk confirmation, staff capabilities, or
native push. The operator must tell invited testers that WhatsApp messages will
not arrive; existing UI text is intentionally unchanged.

## Activation conditions

All three server bindings must match exactly:

- `APP_ENV=staging`
- `STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP=true`
- `WHATSAPP_ENABLED=false`

The new binding defaults to disabled when absent. The checked-in staging config
explicitly enables it after the authorized rollout on 2026-10-26.
It is not a request parameter. Production, sandbox, local development and
confirmation experiments do not acquire this exception. A conflicting
`WHATSAPP_ENABLED=true` disables the exception and uses normal admission rules.
Do not use that conflict as a way to activate real WhatsApp.

Public service joins (including kiosks and QR links), non-experimental legacy
public-queue joins, and authorized staff joins retain their validation, admission,
origin, authentication, permissions, rate limiting and idempotency checks. Only
the technical WhatsApp transport prerequisites are bypassed. Staff still require
`queue.operate` and any queue assignment required by their existing role.

## Durable no-send guarantee

Migration `0039_staging_whatsapp_suppression.sql` adds
`queue_entry.whatsapp_suppressed`, defaulting to zero for existing entries. New
non-experimental entries created in this mode persist one in the same transaction
as their creation, including native entries (whose push policy remains separate).

Phone encryption, consent records, audit events and normal queue participation
remain unchanged. Suppression is not an opt-out or `manual_only` designation.
No WhatsApp outbox intent is created for these entries, including later lifecycle
and action-result notices. Publication, reconciliation and atomic dispatch claims
also enforce suppression. Injected pending notices are cancelled, not sent;
accepted, sending and unknown outcomes are not rewritten by this suppression.
An idempotent retry recovers the original entry and never resets its policy.

Re-enabling the transport later does not enable WhatsApp for these entries.
Do not clear their suppression flags. Historical entries are not backfilled or
cancelled by this rollout. Existing retention and consent revocation still apply.

## Authorized rollout only

1. Obtain explicit authorization for the account, staging deployment, migration
   and any test-entry writes. Read-only diagnostic authorization is insufficient.
2. Record the active Worker version, bindings, migrations and notification
   backlog; capture a D1 backup/Time Travel recovery point. Preserve existing keys,
   push bindings and unrelated configuration. Do not read secret values into logs.
3. Apply only this pending additive migration before deploying the new backend.
   Any future deployment of this backend to another environment also requires the
   migration first; no production deployment is part of this operation.
4. Reuse the exact frontend artifact of the currently deployed staging release.
   Verify its identity/hashes; stop if they cannot be verified. Do not build and
   deploy a frontend from a dirty local checkout as part of this change.
5. Deploy the backend with the new staging flag true and WhatsApp still false.
   Do not install 360Dialog credentials or repoint the production channel.
6. On an explicitly authorized, isolated service, validate new web/kiosk/staff
   entries and native compatibility. Verify one entry per idempotent request,
   suppression one, no WhatsApp intents, no provider calls, and intact audit/queue
   operations. Never use a client's phone or existing turn for this smoke test.

## Rollback

Disable `STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP` and keep WhatsApp false. This restores
the previous web/staff admission block; existing entries remain manageable and
suppressed. Keep the migration and suppression-aware backend. Do not reset D1,
delete turns, replay pending messages or remove the durable flags. If an emergency
requires an older Worker, keep the transport off until a suppression-aware version
is restored; older code does not understand the new no-send policy.

## Local verification

Run the API TypeScript check and Vitest suite, including
`staging-silent-admission.test.ts`, existing production/staging WhatsApp, staff,
mobile lifecycle and webhook/action tests. Run existing web tests without editing
frontend files. Tests use local D1/Miniflare and simulated providers only.
