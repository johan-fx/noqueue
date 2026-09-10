# Deploy an approved environment

**Status:** Blocked until remote environments are provisioned.

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
