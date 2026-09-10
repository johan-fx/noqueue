# Provision Cloudflare only after environment approval

**Status:** Blocked for remote execution.

Before provisioning, record the owning account, environment names, data jurisdiction, D1 names, Durable Object migration strategy and secret owners.

## Approved sequence

1. Authenticate interactively with the intended account.
2. Create one D1 database per environment and record its returned identifier in that environment's configuration.
3. Review Durable Object class migrations before the first deployment.
4. Store provider credentials with Cloudflare secrets, never Wrangler plaintext vars.
5. Run migrations against staging first.
6. deploy a version and verify health, assets and logs.

The repository bootstrap intentionally uses an all-zero local placeholder. Do not deploy it.
