# Provision approved Cloudflare pilot environments

**Status (2026-09-11):** sandbox and staging infrastructure deployed in account `fa5fab4df1b0f12c946a3ea47fab96eb`. WhatsApp sending remains disabled. Production is not provisioned.

See the [360dialog pilot runbook](360dialog-pilot.md) for exact resource IDs, deployed versions, private secret custody, verified checks and remaining provider prerequisites.

## Safe deployment sequence

1. Select the owning account explicitly and inventory resources before creating anything.
2. Reuse the recorded EU D1 databases and environment-specific Queues/DLQs. Jurisdiction is selected at D1 creation, not added later.
3. Keep the per-queue Durable Object EU routing and review class migrations before changing them.
4. Supply missing provider keys and approved recipients through secrets; never overwrite application crypto keys or share values in command arguments.
5. Apply pending migrations only to the explicitly selected remote environment, build and run its deployment dry-run.
6. Deploy with `--env sandbox` or `--env staging`; verify HTTPS health, assets, authorization guards and bindings.

Never deploy the top-level local default configuration or its all-zero database ID. Preserve `WHATSAPP_ENABLED=false` until the provider-specific checklist is complete. Invocation logs and traces remain disabled to avoid recording capability/recovery URLs; structured event logging remains enabled. Queues have no D1-style EU jurisdiction guarantee and carry opaque identifiers only.
