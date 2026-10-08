# Prepare natural WhatsApp lifecycle copy v3

V3 is prepared locally, **not activated or provider-approved**. Its shared catalog supplies the fixed ES/EN provider bodies, ordered body parameters, footer, button labels and exact template names. Sandbox rendering uses that same catalog. V1/V2 messages keep their existing body routing.

## Safe activation checklist

1. Review `apps/api/src/integrations/whatsapp-copy-v3.ts` (`whatsappV3Catalog`) as the registration manifest. There are **20 templates**: eight event kinds × two languages, with three fixed cancellation openings instead of one variable opening. Registration and activation require separate explicit authorization; this change performs neither.
2. Register each body's exact text, footer and URL button with its manifest `name`; use `es_ES` / `en_US`. Supply `examples` as the single `example.body_text` row, in `parameters` order. Examples are fictional, not customer data. The URL-button base is the application's `/t/{{1}}`; its example suffix must be synthetic. Do not register a whole-body variable or the V2 universal seven-parameter contract.
3. Confirm actual provider approval and that approved wording/order matches the manifest before setting `WHATSAPP_V3_TEMPLATES_APPROVED=true`. Each manifest `binding` must contain its exact `name`. Set `STAGING_CONSENT_APPROVED=true` only when consent approval actually exists. Existing sender, phone ID and recipient controls still apply.
4. Only after authorization and those checks, select server-only `WHATSAPP_COPY_VERSION=3`. No Wrangler/default/live profile has been changed to V3 by this implementation.

A cloud public join requires **every selected-locale template**, including all cancellation variants. Each dispatch independently checks its selected binding and V3 approval. Missing/mismatched bindings or approval fail before a provider request; they never fall back to V2. Local loopback admission bypass and controlled sandbox tests retain their existing semantics. A sandbox setting is NOT authorization to send a real test message.

## Template map

For each row and locale, the name is `noqueue_v3_<kind>_<locale>` and the binding is `WHATSAPP_QUEUE_V3_<KIND>_TEMPLATE_<LOCALE>`.

| Kind                 | Ordered body parameters | Button                            |
| -------------------- | ----------------------- | --------------------------------- |
| `queue_joined`       | wait, reference         | View my turn / Ver mi turno       |
| `approaching`        | wait, reference         | View my turn / Ver mi turno       |
| `delayed`            | wait, reference         | View my turn / Ver mi turno       |
| `improved`           | details, reference      | View my turn / Ver mi turno       |
| `ready`              | arrival, reference      | View my turn / Ver mi turno       |
| `expired`            | reference               | Join again / Volver a inscribirme |
| `cancelled_customer` | reference               | View my turn / Ver mi turno       |
| `cancelled_staff`    | reference               | View my turn / Ver mi turno       |
| `cancelled_unknown`  | reference               | View my turn / Ver mi turno       |
| `service_ended`      | reference               | Join again / Volver a inscribirme |

Cancellation remains one event kind; its fixed customer/staff/unknown template variant is selected from the stored reason. Raw reason keys are never shown. Unknown reasons use a safe human cancellation opening.

Improved `details` combines the action first and then wait sentences. Ready `arrival` combines the actual service/resource arrival instruction and complete deadline sentence. Wait/action/arrival sentences have no administrative labels; only the compact reference keeps its fixed marker. Neither combined fragment is an entire-body variable.

Fixed text surrounds parameters, with no adjacent parameters and sequential indices. Bodies are at most 1,024 characters and footers at most 60; example counts match placeholders. See the official [template elements](https://docs.360dialog.com/docs/resources/templates/template-elements) and [template rejection guidelines](https://docs.360dialog.com/docs/resources/templates).

V3 requires configured services. New real selected-V3 joins to legacy queues without service configuration fail as `whatsapp_unavailable`. A newly-created snapshotless lifecycle notice is recorded as a terminal failed outbox intent with `blockedReason=configured_service_required` and a sanitized `whatsapp_copy_profile_unavailable` warning; staff state changes still commit, and no fallback/provider request occurs. Controlled local offline joins remain available, but consented V3 legacy intents are similarly recorded failed rather than sent as V1. Intent creation requires explicit configuration presence from the actual queue configuration; a fallback display snapshot does not establish that presence. Failed intents retain their revision/call-cycle identity. Existing legacy turns are not migrated; already-stored historical V1 messages keep their original routing.

## Durable compatibility

- The JSON snapshot remains `schemaVersion: 2`. Optional `copyVersion` selects V3; missing version means V2. SQL `payload_version=2`, event/idempotency keys, revisions and call cycles are unchanged.
- Selection is stamped when enqueueing, including the independent joined snapshot. Dispatch and retries use stored selection, not current `WHATSAPP_COPY_VERSION`. Absent server selection defaults to V2; an explicitly invalid selection fails closed rather than falling back. Invalid local-bypass intents are unusable and never reconstructed at send time.
- `approachRecommended` is frozen from the existing configurable position/ETA predicate. Improved copy invites a calm approach only when that predicate is true, never claims a resource assignment. Pre-send phase, revision and correction-baseline checks remain intact.
- Known/provisional ETA means total remaining wait, not additional time. Unknown ETA is not zero; null ahead is omitted. Reference deduplicates identical venue/service names. Ready copy includes the actual service and assigned resource when known; missing deadline uses a complete link instruction.
- Locale, recovery token, `source=whatsapp`, notice ID and URL-button suffix keep their existing semantics. Cancelled messages keep the state-view link. Rejoining after service end is conditional on availability.
- Exact replay still precedes admission checks. STOP/BAJA, consent, idempotency, correction frequency and no automatic retry for unknown provider outcomes are unchanged. Normal completion/yield does not gain a new notification kind.

## Local verification

Use the API Vitest suite's disposable D1 database and mocked 360dialog requests. Never point these tests at a development/production database or send real messages. Focused regressions live in `whatsapp-copy-v3.test.ts`, `whatsapp-copy-version.test.ts`, `360dialog-lifecycle.test.ts` and `admission-policy.test.ts`; the existing lifecycle suites cover unchanged safeguards.

Rollback boundary: remove the V3 catalog, its adapter/enqueue/admission changes, new binding declarations and associated tests/docs together. No migration, public API or external activation needs undoing; already-enqueued V3 snapshots would require keeping this reader until drained or explicitly cancelling them. Never reinterpret them as V2.
