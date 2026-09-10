# No Queue monorepo

No Queue is a queue-management platform delivered as a web application and as the same React build inside native Capacitor shells. A Hono Worker exposes the API and will coordinate D1 and Durable Objects.

## Quick path

```bash
pnpm install
pnpm dev
```

Open the Vite UI at <http://localhost:5173> and the API health endpoint at <http://localhost:8787/api/v1/health>.

## Verify the workspace

```bash
pnpm check-types
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm mobile:sync
```

## Workspace map

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React/Vite UI, PWA and web/native experience composition |
| `apps/api` | Hono Worker, API boundaries and Cloudflare bindings |
| `apps/mobile` | Capacitor configuration and native iOS/Android projects |
| `packages/contracts` | Runtime-validated public wire contracts |
| `tests/e2e` | Browser-level system verification |

The original scaffold commands are recorded in [docs/development/bootstrap.md](docs/development/bootstrap.md). Start with the [local stack runbook](docs/runbooks/local-stack.md). Architecture decisions live in [docs/architecture](docs/architecture/monorepo.md) and [docs/decisions](docs/decisions/0001-monorepo-boundaries.md). Product requirements remain in [docs/prd.md](docs/prd.md).
