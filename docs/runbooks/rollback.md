# Roll back code without pretending data rolled back

1. Identify the last healthy Worker version and the incident start time.
2. Stop further deployments and assess whether a schema migration is forward-compatible.
3. Roll back the Worker through the approved Cloudflare deployment mechanism.
4. Verify health, static assets and core queue operations.
5. Monitor errors and notification delivery.

A Worker rollback does not reverse D1 data or migrations. Use the D1 recovery runbook for data incidents; never run a down migration automatically during code rollback.
