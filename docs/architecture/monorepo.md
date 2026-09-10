# Keep the monorepo dependency graph one-way

The repository shares public contracts, not application internals. React and Hono own their runtime behavior; Capacitor consumes the compiled web artifact.

## Dependency graph

```text
@noqueue/contracts ──> @noqueue/web ──build──> @noqueue/mobile
                   └─> @noqueue/api
```

## Rules

- Cross-workspace imports use package names and `workspace:*`; relative imports stay within a workspace.
- `packages/*` never imports from `apps/*`; applications do not import each other's internals.
- D1 rows, Drizzle schemas, Durable Object state and authorization rules are server-only.
- Public request, response, error and realtime payloads belong in `@noqueue/contracts` and are validated at runtime with Zod.
- New packages require a coherent contract and at least two real consumers. Do not create generic `utils`, `common`, `db`, `domain` or `ui` packages speculatively.
- Package exports are explicit subpaths. Avoid barrel files and re-export forests.

## Build ownership

`apps/web` is the only React renderer and owns shadcn, Tailwind, routing and experience composition. `apps/mobile` owns only Capacitor configuration, plugins and generated native projects. Turbo makes mobile synchronization depend on the exact web build.
