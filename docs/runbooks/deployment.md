# Deploy an approved environment

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
Checked-in `wrangler.jsonc` still has safe false defaults. A future ordinary
redeploy without reading/preserving the live overrides would disable the pilot.
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
