# Recover D1 through an evidence-first procedure

**Status:** Remote restore details require the final backup and retention policy.

## Local recovery

1. Stop Wrangler.
2. Preserve `.wrangler/state` as incident evidence when debugging matters.
3. Reset only the local D1 state.
4. Run `pnpm --filter @noqueue/api db:migrate:local`.
5. Start the stack and verify `/api/v1/health` plus affected behavior.

## Remote incident

Do not mutate production first. Record the database, time window, deployment version and suspected writes. Use Cloudflare's currently documented D1 backup/time-travel mechanism for the approved environment, restore into a safe target when possible, validate application invariants, then execute the recovery approved by the incident owner.
