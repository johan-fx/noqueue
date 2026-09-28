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

The API suite applies all migrations to isolated test D1. To migrate a separately authorized local development database, use `pnpm --filter @noqueue/api db:migrate:local`. Migration `0006_queue_resources.sql` is additive. Do not deploy new worker code before this migration. Remote migration, deployment and outbound messaging require separate authorization; none is part of this change.

## Operational rollout

1. Keep **Comparación sin activar** (`estimationMode: shadow`, also the legacy default). Estimates are already honest in this mode, but legacy call acceptance remains unchanged. Legacy position-based values exist only as comparison evidence, never as the displayed resource estimate.
2. Define each space's table/seat groups and mean occupancy minutes in **Gestión de cola → Configuración avanzada**. Reception uses **Puestos de atención**; pool resources are groups of seats, not a shared scalar admission limit.
3. At a genuinely empty service, an owner/manager checks **Confirmo que todos los recursos están vacíos al inicializar**. Both configure and operate capabilities are required. Existing called/completed entries block this assertion. Resolve calls and explicitly release historical completed entries first. Legacy releases without allocations do not produce duration samples.
4. In shadow, known resources are tracked observationally when a free compatible slot exists. This does not reject legacy out-of-order or over-capacity calls. An untracked call remains unknown, not invented occupancy. The system must be drained of untracked called/completed entries before activation.
5. Inspect `queue_wait_evidence`: immutable first non-null forecast, forecast creation time, actual call timestamp, signed error in minutes, original legacy comparison ETA and rollout mode. `queue_forecast_anchor` keeps the first usable forecast even as polling updates the current projection; call-time recalculation cannot erase lateness. These are estimates, not proof of notification delivery. There is no invented accuracy threshold or automatic promotion. Decide establishment by establishment, activating each service with **Activo** when its evidence and operational discipline are adequate.
6. Active calls enforce available compatible capacity and oldest compatible order. A deliberate exception requires **Motivo de excepción al orden**; the exact reason and actor are persisted. No automatic time estimate changes sequence.

| Staff action | Meaning |
|---|---|
| Llamar | Reserve one free compatible resource. No resource is freed merely because its estimate passed. |
| Confirmar llegada | Mark arrival and begin occupied-duration measurement. Stored entry status remains `completed` for compatibility; the UI says **En servicio**. |
| Liberar recurso | End actual occupancy, mark `served`, record a usable arrival-to-release sample. |
| Cancelar / No presentado | Release a reservation, never create an occupied-duration sample. No-show retains the configured grace period. |
| Pasar al final | Explicitly append sequence; estimates alone never reorder entries. |

“Avanzar un turno” selects a party with actual `callable` capacity in active mode. Approximate/provisional ETA is never a readiness signal. The server remains the authority, and may refuse if state changed since the last poll. Refresh and retry using the returned current version.

## Configuration and legacy upgrade

- Group identity is `(space.id, seats)`. Physical resources have internal IDs derived from this identity and an ordinal; their duration is never configured individually.
- Existing spaces receive deterministic `legacy-N` identities when normalized; saves persist them. New UI spaces use UUIDs. Preserve IDs across rename/reorder; do not copy an old ID to a new space.
- Each `tableTypes` row stores `averageMinutes`. Missing means inherit the legacy matching `queueBySeat` duration, then the service baseline. Legacy `queueBySeat` data is retained; its admission capacity is not physical resource count.
- Service `capacity` remains the admission limit. Resource count comes only from group `count`, legacy space `tables`, or reception `stations` (default one).
- Spaces without a table breakdown remain supported as provisional generic resources. Unknown starting occupancy never becomes known automatically. Configure real groups before relying on precise compatibility estimates.
- Occupied resource removal, size changes and count reduction that would remove an occupied ordinal are rejected. Drain before changing topology or disabling active enforcement.
- Recent valid arrival→release observations are progressively weighted against a configured prior. Fewer than three recorded observations retain the configured duration; cancelled/no-show/incomplete intervals do not contribute. Samples outside 1–1440 minutes are excluded.
- **Ajustes temporales** offer two variants: **Duración estimada** (`kind: duration`, or omitted for legacy adjustments) overrides mean occupied minutes; **Bloquear disponibilidad hasta caducidad** (`kind: availability`) prevents calls to that space/size group until `expiresAt`, even if its resources are currently free. The block also advances its forecast without affecting other groups. Both require a reason, expiry within 24 hours, and configure/operate permission; audit snapshots retain actor and reason. Neither changes sequence or frees an occupied resource. Expiry is recalculated by the existing minute cron and on reads without another queue action.

## Projection, evidence and delivery safety

The pure scheduler chooses earliest predicted availability, breaking ties by smallest sufficient seats. A preferred space is used whenever it contains a compatible group; only absence of such a group allows fallback. Occupancy predictions simulate future releases but never mutate the allocation table. A reservation without arrival or an overdue occupied interval has unknown release time. Observed call cadence may provide a clearly provisional fallback anchored to the most recent actual call plus one positive cadence interval for the head party. Polling reduces the remaining wait without moving that timestamp forward. Once the next call is overdue without actual progress, the fallback becomes unknown. This fallback is never callable capacity; insufficient evidence also remains unknown.

The queue Durable Object serializes joins, staff commands, configuration and refreshes. D1 batches commit each lifecycle command with allocation, audit and idempotency data. A unique partial allocation index prevents double occupancy. Projection plus its update intent commit together afterward, before any delivery. A crash between lifecycle and projection is repaired by idempotent replay, the next read or the minute sweep. Public token reads are serialized snapshots.

`queue_estimate_intent` deduplicates by entry/revision. Every new intent is `policy_pending`; no new ETA/position intent is sent to WhatsApp. No frequency, magnitude or notification threshold has been invented. A future approved dispatcher must coalesce superseded revisions, join these intents to the existing outbox, and recheck live queue-update consent, STOP state, contact eligibility and approved templates immediately before sending. Existing joined-message/confirmation behavior is unchanged.

Evidence contains no phone numbers or message bodies. Entry-associated projection, immutable forecast anchor, intent, allocation and wait-evidence rows cascade on entry deletion, matching existing privacy cleanup. Adjustment audit is retained with its queue.

## Rollback boundaries

There are no commits or deployment in this work. Reviewable uncommitted units are:

1. Contracts, pure engine and their tests: group identity and deterministic scheduling.
2. Additive migration, projection adapter, serialized API lifecycle and integration tests: resource operation and durable evidence.
3. Staff/public forms, displays and UI tests plus this runbook: operational access and honest estimates.

These units have dependencies and are not safe to remove independently from an already-running worker. First drain active allocations and switch the service to shadow. Keep the additive tables and evidence when rolling worker/UI code back; do not drop tables or reconstruct occupancy from predictions. Reverting the whole uncommitted feature is safe only before deployment and after preserving unrelated changes.
