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

## Public queue displays

The staff queue drawer exposes the existing public queue, a shared-tablet registration
page (`/q/:queueId/kiosk`), and a QR display (`/q/:queueId/qr`). These pages use the
public admission endpoints; no staff session or operator permissions are used.
Registration requires a name, valid phone number and explicit WhatsApp consent.
After admission, personal fields are discarded and the screen resets after 10 seconds
or when the next-registration button is pressed. Recovery tokens are never displayed
or stored by the tablet. The existing per-IP admission limit also applies to tablets.

Set `VITE_PUBLIC_APP_ORIGIN` at **web build time** to the public web origin (for example,
`https://queues.example.com`), matching the API's `PUBLIC_APP_ORIGIN`. Use an origin
only, with no path, query, fragment or credentials. Web development may omit this
value and use the current browser origin. Native builds require a non-loopback HTTPS
origin: missing or invalid configuration disables the links and reports an error
instead of sending guests to the Capacitor origin or `localhost`.

Native links open via Capacitor Browser; registration and QR remain public web pages,
not additional native routes. Build the web app with the configured public origin,
then run `pnpm mobile:sync` to register the plugin in the existing native projects.
