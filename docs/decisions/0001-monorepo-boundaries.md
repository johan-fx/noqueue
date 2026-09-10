# ADR 0001: Share contracts, not application internals

**Status:** Accepted

## Decision

Use pnpm workspaces and Turborepo. Keep runtime code inside `apps/web` and `apps/api`; expose versioned Zod wire contracts from `packages/contracts` through explicit subpaths.

## Consequences

- Persistence changes cannot leak into public DTOs accidentally.
- A package is added only after a real ownership boundary appears.
- TypeScript remains useful across the boundary, while runtime validation protects independently deployed clients.
