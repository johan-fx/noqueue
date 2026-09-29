# Resource-aware queue rollout

Queue estimates use parallel compatible resources, not queue position multiplied by table occupancy time. All customer and staff reads share the stored projection. An unavailable estimate has `estimateQuality: "unknown"`, `predictedAt: null`, and a compatibility-only numeric `etaMinutes: 0`; clients must show unavailable wording, not “0 minutes”.

## Local verification and deployment boundary

```sh
pnpm --filter @noqueue/contracts test
pnpm --filter @noqueue/api test
pnpm --filter @noqueue/web test
pnpm check-types
pnpm --filter @noqueue/web lint
git diff --check
```

The API suite applies all migrations to isolated test D1. To migrate a separately authorized local development database, use `pnpm --filter @noqueue/api db:migrate:local`. Migrations `0006_queue_resources.sql` and `0007_queue_opening.sql` are additive. Deploy the migrations first, then the API, then the web app. Do not deploy the worker before applying both migrations. Remote migration, deployment and outbound messaging require separate authorization; none is part of this change.

## Operational rollout

1. Define each space's table/seat groups and mean occupancy minutes in **Gestión de cola → Configuración avanzada**. Reception uses **Puestos de atención**; pools use groups of seats.
2. Intelligent management is automatic by default for each queue. No establishment opt-in or NoQueue approval is required. The old deployment-policy table remains for additive compatibility, but its rows (enabled or disabled) are ignored and never interpreted as a staff preference.
3. Staff with `queue.operate` use **Abrir cola**. A bottom Sheet presents spaces as tabs and resource sizes as accordions. Every configured group requires an explicit occupied count, including zero. Counts exclude displayed queue-owned reservations. Missing resource breakdown still permits initial operation, with a configuration notice.
4. The server automatically enables intelligent management after a fresh complete inventory, valid configuration and resolution of legacy called/completed entries without allocations. Previously confirmed queues waiting only for deployment enablement activate on the next serialized recalculation/read, without another survey. Existing queues with unknown occupancy still require explicit confirmation. Staff never select technical modes. Closing and reopening always requires a fresh inventory.
5. In **Gestionar cola → ⋯ → Actualizar ocupación**, staff correct external occupancy or choose **Liberar uno**, then save the change with a reason. External occupancy has no true arrival timestamp, never generates learned-duration samples, and never becomes free merely because time passes. Forecasts that might change due to these resources are provisional or unknown. Correct physical counts are essential; the system does not sense tables automatically.
6. **Cerrar cola** requires confirmation, displays pending waiting/called turns, and stops only new admissions. Existing turns, reservations and external holds remain; staff can continue service and release resources while closed. Once inventory is confirmed, every call requires actual free compatible capacity even before intelligent ordering is enabled. Only oldest-compatible order enforcement waits for active mode; an explicit order exception never bypasses occupied capacity. Legacy queues with unknown inventory retain their provisional fallback.

Readiness appears on the service Card. Missing configuration links naturally to **Configurar servicio**; inventory is collected on opening, legacy turns are resolved in **Gestionar cola**, and a persistent manual opt-out is labelled **Desactivada manualmente**. Observe `queue_wait_evidence` (immutable first forecast versus actual call time), `queue_inventory_audit`, conflicts, and aged `queue_external_occupancy.recorded_at` during deployment. No accuracy or notification thresholds are invented.

| Staff action | Meaning |
|---|---|
| Llamar | Reserve one free compatible resource. No resource is freed merely because its estimate passed. |
| Confirmar llegada | Mark arrival and begin occupied-duration measurement. Stored entry status remains `completed` for compatibility; the UI says **En servicio**. |
| Liberar recurso | End actual occupancy, mark `served`, record a usable arrival-to-release sample. |
| Cancelar / No presentado | Release a reservation, never create an occupied-duration sample. No-show retains the configured grace period. |
| Pasar al final | Explicitly append sequence; estimates alone never reorder entries. |

“Avanzar un turno” selects a party with actual `callable` capacity in active mode. Approximate/provisional ETA is never a readiness signal. The server remains the authority, and may refuse if state changed since the last poll. Refresh and retry using the returned current version.

## Confirm occupancy without closing admissions

For an already-enabled queue with configured resources but no valid inventory, choose **Confirmar ocupación** on the service Card. Complete every space/size group or explicitly choose **Todas las mesas restantes están libres**, then confirm. Nothing defaults to zero; the shortcut only fills the draft. Queue-owned reservations and existing turns are preserved. This initial declaration needs no correction reason and does not change the admissions switch. Once confirmed, **Gestionar cola → ⋯ → Actualizar ocupación** edits individual counts with an audit reason as before.

If configuration is incomplete, configure the resource groups first. Confirmation establishes safe physical capacity even when staff have disabled intelligent management. It never clears the manual opt-out.

**Cola habilitada** means the manual admissions switch is on, not that the current time permits entry. **Fuera de horario** comes from the server's same timezone/schedule/cutoff rule used for joining. Time never changes the switch automatically. Closing and reopening still requires a new survey.

## Manual control without losing occupancy

Staff with `queue.operate` can choose **Desactivar gestión inteligente** from **Gestionar cola → ⋯** and confirm in a bottom Sheet. This disables intelligent ordering, not physical capacity checks: calls still require a compatible free resource whenever inventory is managed. Reservations, occupied holds, arrivals and current turns are unchanged.

The per-queue `intelligencePolicy` defaults to `automatic`; explicit `disabled` persists through refresh, configuration saves, inventory confirmation and closing/reopening. **Volver a gestión automática** restores automatic policy, but effective activation still waits for complete configuration, confirmed current inventory and resolution of unassigned legacy service turns. Configuration-only and viewer users cannot change this policy, including through configuration PATCH or initial provisioning.

The queue drawer header’s **Volver** arrow returns to the Dashboard without changing admissions. The overflow menu opens bottom Sheets above the queue drawer; cancelling or saving returns focus to that menu. The service Card keeps only management/configuration actions and the visible initial-inventory prompt.

## Configuration and legacy upgrade

- Group identity is `(space.id, seats)`. Physical resources have internal IDs derived from this identity and an ordinal; their duration is never configured individually.
- Existing spaces receive deterministic `legacy-N` identities when normalized; saves persist them. New UI spaces use UUIDs. Preserve IDs across rename/reorder; do not copy an old ID to a new space.
- Each `tableTypes` row stores `averageMinutes`. Missing means inherit the legacy matching `queueBySeat` duration, then the service baseline. Legacy `queueBySeat` data is retained; its admission capacity is not physical resource count.
- Service `capacity` remains the admission limit. Resource count comes only from group `count`, legacy space `tables`, or reception `stations` (default one).
- Spaces without a table breakdown remain supported as provisional generic resources. Unknown starting occupancy never becomes known automatically. Configure real groups before relying on precise compatibility estimates.
- Occupied resource removal, size changes and count reduction that would remove an occupied ordinal are rejected. Topology changes require closing an intelligent queue first; occupied resources remain protected even while closed. A topology change invalidates the old inventory and requires a fresh inventory confirmation. Durable `inventory_confirmed`/`inventory_invalidated` audit evidence prevents returning to unallocated legacy calls even after all retained allocations/holds drain or old entries are cleaned up. Arrival confirmation and release remain available while closed; new calls wait for resurvey. Mean-duration changes remain allowed while open.
- Recent valid arrival→release observations are progressively weighted against a configured prior. Fewer than three recorded observations retain the configured duration; cancelled/no-show/incomplete intervals do not contribute. Samples outside 1–1440 minutes are excluded.
- **Ajustes temporales** offer two variants: **Duración estimada** (`kind: duration`, or omitted for legacy adjustments) overrides mean occupied minutes; **Bloquear disponibilidad hasta caducidad** (`kind: availability`) prevents calls to that space/size group until `expiresAt`, even if its resources are currently free. The block also advances its forecast without affecting other groups. Both require a reason, expiry within 24 hours, and configure/operate permission; audit snapshots retain actor and reason. Neither changes sequence or frees an occupied resource. Expiry is recalculated by the existing minute cron and on reads without another queue action.

## Projection, evidence and delivery safety

The pure scheduler chooses earliest predicted availability, breaking ties by smallest sufficient seats. A preferred space is used whenever it contains a compatible group; only absence of such a group allows fallback. Occupancy predictions simulate future releases but never mutate the allocation table. A reservation without arrival or an overdue occupied interval has unknown release time. Observed call cadence may provide a clearly provisional fallback anchored to the most recent actual call plus one positive cadence interval for the head party. Polling reduces the remaining wait without moving that timestamp forward. Once the next call is overdue without actual progress, the fallback becomes unknown. This fallback is never callable capacity; insufficient evidence also remains unknown.

The queue Durable Object serializes joins, staff commands, configuration, opening-context reads, lifecycle commands and refreshes. `GET /queues/:id/opening-context` returns a fingerprint of configuration/version, entries, allocations, external holds and readiness. `POST /queues/:id/lifecycle` accepts `open`, `confirm_inventory`, `close`, `occupancy`, `disable_intelligence` or `enable_intelligence` with that fingerprint and an idempotency key. A conflict requires refreshing and reconfirming; an ambiguous retry of the same payload retains its key. Generic configuration PATCH cannot change open/mode/known state; commercial configure-only access cannot operate a queue. SQL triggers prevent queue allocations and external holds from occupying the same resource. D1 batches commit each lifecycle command with allocation, audit and idempotency data. A unique partial allocation index prevents double occupancy. Projection plus its update intent commit together afterward, before any delivery. A crash between lifecycle and projection is repaired by idempotent replay, the next read or the minute sweep. Public token reads are serialized snapshots.

`queue_estimate_intent` deduplicates by entry/revision. Every new intent is `policy_pending`; no new ETA/position intent is sent to WhatsApp. No frequency, magnitude or notification threshold has been invented. A future approved dispatcher must coalesce superseded revisions, join these intents to the existing outbox, and recheck live queue-update consent, STOP state, contact eligibility and approved templates immediately before sending. Existing joined-message/confirmation behavior is unchanged.

Evidence contains no phone numbers or message bodies. Entry-associated projection, immutable forecast anchor, intent, allocation and wait-evidence rows cascade on entry deletion, matching existing privacy cleanup. Adjustment audit is retained with its queue.

## Rollback boundaries

No deployment is performed by this change. Reviewable work units are:

1. Lifecycle contracts, pure uncertainty handling, additive migration and API integration tests.
2. Mobile Sheets, Card readiness, removed manual mode controls, UI tests and mobile E2E.
3. This operational rollout guide, delivered with the feature.

Keep additive tables and audits during rollback. The legacy deployment-policy table is not a kill switch. Use the audited per-queue manual policy to stop intelligent ordering while retaining capacity safety. Before rolling back to code that cannot read external holds, close admissions and drain all queue allocations and external holds. Never drop these tables or treat closing as an occupancy reset. Restore prior application code only after the physical inventory is reconciled; otherwise old code could allocate an externally occupied table.
