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

The staff queue drawer's “Abrir enlace público” button only opens a dropdown with
two options: “Inscripción”, a shared-tablet registration page (`/q/:queueId/kiosk`),
and “QR”, a QR display (`/q/:queueId/qr`). It never directly opens the personal
queue flow. The QR encodes the public queue URL for guests to scan with their own
phones; the shared display has no clickable link into that personal flow.
Both displays use a centered, fluid column on mobile, portrait and landscape
tablets, and desktop, with natural vertical scrolling. These pages use the
public admission endpoints; no staff session or operator permissions are used.
Registration, its thank-you state, and QR display the venue's uploaded logo in a
192 × 111 px contain slot (left-aligned on registration/thanks, centered on QR).
The public service context exposes only `venueLogoUrl`, not filenames or editing
permissions. Existing polling refreshes replacements/deletions. Missing or failed
images leave no empty slot; the registration and QR flows remain usable.
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

## Admin metrics (local implementation)

Metrics use D1 creation-date cohorts, a transactional entry/revision journal and
incremental daily/hourly aggregates. Completion means **confirmed arrival**, not
end of service. Wait means first actual call minus admission; attention divides
completed by resolved entries. Pending/unknown entries remain in reconciliation.
Occupancy is real waiting-person time divided by observed queue time, not a sum
of queue lengths. UTC bucket identities distinguish repeated local hours.

- Apply additive migration `0027_admin_metrics.sql` before enabling capture.
- `METRICS_CAPTURE_ENABLED=true` controls capture/backfill/processing independently
  of `METRICS_DASHBOARD_ENABLED=true`, which exposes the staff metrics API and tab.
  Both default on in local Wrangler vars; neither is enabled in remote env vars.
- `*/15 * * * *` is a separate branch in the existing Worker. The one-minute
  operational task is unchanged. A 30-second watermark margin avoids in-flight
  commands. Work drains bounded pages within a 20-second wall-clock budget and resumes via persisted cursor, lease and fencing.
- Backfill runs bounded batches through the existing coordinator's serialization,
  **without operational refresh**. `metrics_backfill` records progress per queue;
  unknown historical service types and missing occupancy remain explicitly partial.
  Imported historical timestamps use the timezone available at import (not an
  assertion of the historical timezone); that limitation is returned in coverage notes.
- `metrics_control.last_complete_at` advances only after the cut is integrated.
  A stale cut (>30 minutes), unfinished backfill and capture gaps are exposed as
  incomplete/updating data; reads never fall back to operational histories.
- Closed dirty partitions within the retained detail horizon are reconciled in
  bounded batches. Older aggregates are never rebuilt from truncated detail.
- Aggregates retain 13 calendar months; processed detail retains 90 days. Pending
  and restorable expired entry state survives longer. Operational retention is
  untouched. Purges are bounded and can require multiple scheduled runs.

For a **future authorized staging rollout**: apply the migration, enable capture,
observe backfill and cut progress, compare reconciliation/sample counts, verify
D1 rows read/written and actual Worker CPU against the account's real limits,
then enable the dashboard. Local tests do not establish remote CPU or Free-plan
compatibility. Do not enable remotely until that budget has been checked.
To roll back the UI, disable only `METRICS_DASHBOARD_ENABLED`; retain capture and
all tables. Disabling capture records a conservative coverage gap on the next
metrics tick; re-enabling schedules a bounded state repair. Do not delete tables
or silently reconstruct old aggregates.

Verification: `pnpm --filter @noqueue/api exec vitest run src/features/metrics`
plus the web Commercial/CommercialMetrics tests and standard type/lint/build.
