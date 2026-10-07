# Operate service-specific queues and arrival notices

Reception and every pool service assign the oldest waiting turn through **Asignar próximo turno**. Restaurants assign the selected compatible group through the existing sheet. Arrival confirmation is direct; only restaurants retain a table until its later release from Completed turns.

## Arrival deadlines

- Configure grace per queue in advanced settings: 2 minutes for newly configured reception/pool queues, 5 for restaurants. Valid range: 1–120 minutes.
- Existing values, including explicit or unclassified 5-minute values, are preserved. Only absent legacy values receive defaults.
- The server snapshots the deadline when assigning, even when delivery fails. Delivery, retries and later settings changes never extend it.
- A present restaurant guest is assigned and confirmed atomically, without a ready notice or arrival deadline.
- Legacy assigned turns without deadlines are not retroactively expired. Resolve them before changing grace; other settings remain editable.

## Delivery setup and diagnostics

Apply the additive `0013_delivery_trace.sql` migration with the release's normal database process **before deploying this code**. No production migration or messaging setup is performed by local tests.

Production template sends require the existing WhatsApp enablement, consent approval and recipient allowlist gates, plus independently approved template names:

| Notice | Template configuration variables |
| --- | --- |
| Assignment | `WHATSAPP_QUEUE_READY_TEMPLATE_ES`, `WHATSAPP_QUEUE_READY_TEMPLATE_EN` |
| Approaching | `WHATSAPP_QUEUE_APPROACHING_TEMPLATE_ES`, `WHATSAPP_QUEUE_APPROACHING_TEMPLATE_EN` |
| Expired | `WHATSAPP_QUEUE_EXPIRED_TEMPLATE_ES`, `WHATSAPP_QUEUE_EXPIRED_TEMPLATE_EN` |

Each template uses the same parameter shape as the joined template: venue and turn code in the body, recovery token as the dynamic URL button suffix, with `es_ES`/`en_US` locales. Its approved wording must match its semantic notice. A missing template fails closed; the joined template is never substituted. Sandbox messages use distinct text instead.

Assignment and expiry commit a durable, deduplicated outbox intent together with the state transition, then publish a queue job. A publication failure leaves the committed deadline unchanged; the existing minute-based scheduled reconciliation recovers pending jobs. Approaching uses existing approach thresholds and at most one intent per turn. There is no second ready/reminder call. Dispatch rejects stale state/thresholds, retains consent and opt-out checks, and serializes on the queue coordinator.

Open **Configuración avanzada → Trazabilidad de avisos (7 días)** for recent events. Accepted, sent, delivered and read are different states; unknown outcomes are not automatically retried. Evidence retains queue code, semantic kind, attempt number, safe status/error codes and server timestamps—not message bodies, phones, tokens or secrets. The scheduled purge removes trace older than seven days and processed delivery-status webhook records; it does not remove pending jobs, consent or business history.

## Release and rollback boundary

The action contract, API policy, UI matrix and their tests form one coordinated behavior change. Deploy them together. The trace migration is additive and may remain during an application rollback; do not drop historical queue, outbox or allocation data. Local/browser tests use isolated D1 and simulated providers, not production recipients.
