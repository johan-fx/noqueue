# API Worker

This Hono Worker owns server-side behavior and Cloudflare bindings. Use root commands for development and checks. `wrangler.jsonc` contains a local placeholder and provisioned sandbox/staging resource IDs; follow [`docs/runbooks/cloudflare-provisioning.md`](../../docs/runbooks/cloudflare-provisioning.md) before any remote operation.

## WhatsApp pilot

Use the [360dialog pilot runbook](../../docs/runbooks/360dialog-pilot.md) for the isolated local end-to-end test, Sandbox setup, staging gates and operational recovery. Checked-in sending defaults remain disabled. Staging can have explicitly authorized live deployment overrides; preserve those overrides on redeploy rather than treating source defaults as current remote state. See the runbook for secret custody and staging approval gates.


## Shared private experiment

The [confirmation experiment](../../docs/runbooks/confirmation-experiment.md) has a lightweight server-rendered, Spanish client-facing page: private login, four guided steps, distinct staff/guest views, consent versus delivery status, and an explicit shared-queue reset confirmation. It is not a production staff console.

`STAGING_EXPERIMENT_OPEN_RECIPIENTS` defaults to **false**. When explicitly enabled alongside all live staging experiment gates, participants with the private pilot token may use their own phone even when it is outside the existing allowlist. The exception applies only to the dedicated experiment queue's confirmation and position messages. Ordinary APIs/messages retain their allowlist; do not delete or wildcard the allowlist secret.

Access is not consent: prior first-contact authorization and actual WhatsApp CONFIRMO remain mandatory. This is one shared active tester at a time, not bulk messaging. Rate limits, four queue slots, STOP suppression, 24-hour window and unknown-delivery safeguards are unchanged. Real messages can incur provider charges. A deployment must preserve live overrides and explicitly set the new flag; no QA run should send real messages.
