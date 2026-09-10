# ADR 0003: Use Hono and Zod without tRPC

**Status:** Accepted

## Decision

Hono owns HTTP routing. Zod contracts define runtime-validated public payloads. Hono's `AppType` remains available for a future generated or dedicated first-party client, but the repository will not run a second tRPC routing and middleware stack.

## Consequences

- APIs remain Fetch-native on Workers and can be documented with OpenAPI later.
- Mobile compatibility relies on versioned wire contracts, not only compile-time inference.
- Breaking changes require a new API version rather than silently changing an installed client's contract.
