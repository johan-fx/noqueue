# Run the complete stack locally

## Quick path

```bash
pnpm install --frozen-lockfile
pnpm --filter @noqueue/api db:migrate:local
pnpm dev
```

Open <http://localhost:5173>. Verify the API separately:

```bash
curl --fail http://localhost:8787/api/v1/health
```

Expected JSON:

```json
{"status":"ok","service":"noqueue-api"}
```

## Verification

```bash
pnpm check-types
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Recovery

| Symptom | Action |
| --- | --- |
| Port 5173 or 8787 is occupied | Stop the old process; do not silently change documented ports |
| Binding types are stale | Run `pnpm --filter @noqueue/api cf-typegen` |
| Capacitor reports missing web assets | Run `pnpm --filter @noqueue/web build` |
| Dependency graph is inconsistent | Remove no lockfiles; run `pnpm install --frozen-lockfile` to expose drift |

Resetting local D1 deletes local data. If a clean database is necessary, back up `.wrangler/state` first, then remove only the local D1 state and rerun the local migrations. Never apply that procedure to a remote environment.
