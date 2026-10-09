# Prepare natural WhatsApp lifecycle copy v4

V4 is prepared locally, **not activated or provider-approved**. Its immutable ES/EN catalog defines exact bodies, ordered body parameters, STOP/BAJA footer, button types and labels, template names, and bindings. Sandbox rendering and cloud dispatch use that same catalog. V1–V3 copy and snapshots remain unchanged; the server default remains V2.

## Safe activation checklist

1. Review `apps/api/src/integrations/whatsapp-copy-v4.ts` (`whatsappV4Catalog`) as the registration manifest. It contains **24 templates**: 12 lifecycle variants × two locales. Register the exact body, footer, ordered parameters/examples, and button layout from each catalog entry; use `es_ES` and `en_US`. Never register a whole-body variable.
2. URL-button templates use the venue selector route `/v/{{1}}`. The sender supplies only the suffix `venueId?lang=<locale>&source=whatsapp`; retain that path and query contract. This is a selector link, not an automatic rejoin. The joined message instead includes its notice-bound `/t/<recovery-token>?lang=<locale>&source=whatsapp&notice=<notice-id>` link in the body.
3. Confirm actual provider approval and exact wording, placeholder order, footer, URL prefix, quick-reply labels, and button count before setting `WHATSAPP_V4_TEMPLATES_APPROVED=true`. Each per-locale binding below must equal its exact template name. `STAGING_CONSENT_APPROVED=true` is also required for cloud template sends. Existing sender, phone-ID, recipient, and consent controls still apply.
4. Only after explicit authorization and those checks, select server-only `WHATSAPP_COPY_VERSION=4`. No provider template was registered or activated by this implementation. Missing approval or a missing/mismatched binding fails closed; it never falls back to an older profile.

## Template map

The exact names follow `noqueue_v4_<variant>_<locale>`; the exact bindings follow `WHATSAPP_QUEUE_V4_<VARIANT>_TEMPLATE_<LOCALE>`. The expanded ES/EN names and bindings are shown here so they can be compared directly to approved provider records.

| Variant | ES / EN template name | ES / EN binding | Ordered body parameters | Buttons |
| --- | --- | --- | --- | --- |
| `queue_joined` | `noqueue_v4_queue_joined_es` / `noqueue_v4_queue_joined_en` | `WHATSAPP_QUEUE_V4_QUEUE_JOINED_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_QUEUE_JOINED_TEMPLATE_EN` | venue, reference, wait, recovery | None; recovery URL is in the body |
| `approaching` | `noqueue_v4_approaching_es` / `noqueue_v4_approaching_en` | `WHATSAPP_QUEUE_V4_APPROACHING_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_APPROACHING_TEMPLATE_EN` | venue, wait | Two ordered quick replies: yield, cancel |
| `delayed` | `noqueue_v4_delayed_es` / `noqueue_v4_delayed_en` | `WHATSAPP_QUEUE_V4_DELAYED_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_DELAYED_TEMPLATE_EN` | venue, wait | None |
| `ready` | `noqueue_v4_ready_es` / `noqueue_v4_ready_en` | `WHATSAPP_QUEUE_V4_READY_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_READY_TEMPLATE_EN` | venue, resource, recovery | Two ordered quick replies: yield, cancel |
| `improved_wait_recommended` | `noqueue_v4_improved_wait_recommended_es` / `noqueue_v4_improved_wait_recommended_en` | `WHATSAPP_QUEUE_V4_IMPROVED_WAIT_RECOMMENDED_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_IMPROVED_WAIT_RECOMMENDED_TEMPLATE_EN` | venue, wait | Two ordered quick replies: yield, cancel |
| `improved_wait_neutral` | `noqueue_v4_improved_wait_neutral_es` / `noqueue_v4_improved_wait_neutral_en` | `WHATSAPP_QUEUE_V4_IMPROVED_WAIT_NEUTRAL_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_IMPROVED_WAIT_NEUTRAL_TEMPLATE_EN` | venue, wait | Two ordered quick replies: yield, cancel |
| `improved_ready` | `noqueue_v4_improved_ready_es` / `noqueue_v4_improved_ready_en` | `WHATSAPP_QUEUE_V4_IMPROVED_READY_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_IMPROVED_READY_TEMPLATE_EN` | venue, resource, recovery | Two ordered quick replies: yield, cancel |
| `expired` | `noqueue_v4_expired_es` / `noqueue_v4_expired_en` | `WHATSAPP_QUEUE_V4_EXPIRED_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_EXPIRED_TEMPLATE_EN` | venue | One URL button: “Elegir lista de espera” / “Choose a waiting list” |
| `cancelled_customer` | `noqueue_v4_cancelled_customer_es` / `noqueue_v4_cancelled_customer_en` | `WHATSAPP_QUEUE_V4_CANCELLED_CUSTOMER_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_CANCELLED_CUSTOMER_TEMPLATE_EN` | venue | One URL button: “Elegir lista de espera” / “Choose a waiting list” |
| `cancelled_staff` | `noqueue_v4_cancelled_staff_es` / `noqueue_v4_cancelled_staff_en` | `WHATSAPP_QUEUE_V4_CANCELLED_STAFF_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_CANCELLED_STAFF_TEMPLATE_EN` | venue | None |
| `cancelled_unknown` | `noqueue_v4_cancelled_unknown_es` / `noqueue_v4_cancelled_unknown_en` | `WHATSAPP_QUEUE_V4_CANCELLED_UNKNOWN_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_CANCELLED_UNKNOWN_TEMPLATE_EN` | venue | None |
| `service_ended` | `noqueue_v4_service_ended_es` / `noqueue_v4_service_ended_en` | `WHATSAPP_QUEUE_V4_SERVICE_ENDED_TEMPLATE_ES` / `WHATSAPP_QUEUE_V4_SERVICE_ENDED_TEMPLATE_EN` | venue | None |

All templates use the fixed locale footer in the catalog: “Envía BAJA para dejar de recibir avisos.” / “Reply STOP to stop receiving updates.” Parameter examples are fictional; use the manifest examples in the listed order. Text is fixed around sequential placeholders, not replaced with an entire-body variable.

V4 has at most two buttons per template. The quick replies are “Pasar turno” then “Abandonar la lista” / “Pass my turn” then “Leave the list”. They carry opaque, signed server payloads; button titles are never treated as command authority. The URL-button labels fit the provider's 25-character template limit. Do not add a third button. Native actions apply on one tap; the direct result is a separate service-window reply (text for yield, selector CTA for cancellation), not another template or confirmation prompt.

The successful WhatsApp cancellation result uses a **standalone interactive `cta_url`** selector, separate from the approved template URL button. Its short labels are “Elegir lista” / “Choose a list”. The 360dialog standalone CTA reference documents the payload shape but not a display-text limit; the sender therefore enforces a conservative 20-character maximum, matching 360dialog's documented limit for interactive carousel URL-button labels. Do not apply that 20-character conservative sender rule to template URL buttons; those use the template-specific 25-character limit. See 360dialog's [standalone CTA URL](https://docs.360dialog.com/docs/messaging/message-types/interactive/call-to-action-url-button), [interactive carousel](https://docs.360dialog.com/docs/messaging/message-types/interactive/media-carousel), and [template elements](https://docs.360dialog.com/docs/resources/templates/template-elements) references.

## Copy and lifecycle rules

- `venue` is the establishment name; `resource` is the assigned service/resource fallback. Do not substitute the service label for the establishment name.
- `wait` includes only known facts. A known ahead count uses correct zero/singular/plural wording; an unknown ahead count is omitted. Unknown ETA is not zero and remains explicitly unknown.
- `improved_wait_recommended` is still a waiting party and never claims a resource is available. `improved_ready` is used only when an actual call beats the last accepted absolute forecast by the configured material threshold. A better waiting ETA alone never means “ready”.
- No verified venue timezone is available for rendering an exact local arrival clock. Ready copy links to the turn screen for its authoritative arrival deadline instead of calculating a moving “next N minutes” at dispatch. The retry body and parameter snapshot therefore do not change as time passes.
- Joined, delayed, and yield states have no button row. Only a WhatsApp-origin yield receives a direct result; web yield, normal arrival, and completion do not create a WhatsApp message. A customer cancellation uses the selector CTA; a staff cancellation does not.
- Selector navigation preserves `lang` and `source=whatsapp`, presents currently available lists, and never automatically reenrolls a customer.
- Direct action-result replies are bound to the authenticated inbound event and its phone/context, and are sent only inside the 24-hour user service window. A requested result after STOP does not restore consent or permit proactive notices; no free-form reply is sent outside the service window.

## Durable compatibility and fail-closed behavior

- V4 remains an additive copy profile. An absent `WHATSAPP_COPY_VERSION` still means V2; accepted explicit values are 2, 3, and 4. An invalid explicit value fails closed.
- Copy version, variant, and signed action lifecycle context are frozen in the existing outbox snapshot at creation. Dispatch/retry uses that frozen snapshot rather than the current profile. Existing V1–V3 snapshots are never reinterpreted. No database migration is required.
- New admission checks the complete selected-locale V4 catalog and approval flags. Each cloud dispatch independently checks its selected binding and approval. Quick-reply sends also require their server-generated action payloads; URL sends require the venue context. A missing prerequisite is not silently downgraded.
- The existing durable webhook row stores inbound action payload and provider context before acknowledgment. The serialized queue command atomically commits the command, events, processed inbound event, and one deduplicated result intent. Invalid sender/context/signature, expired lifecycle, phase/call-cycle mismatch, and duplicate actions cannot perform another mutation.
- STOP cancels proactive notices but does not discard an already-authorized, exact event-bound result intent. The exception does not clear STOP or reopen consent.

## Local verification

Use the API's disposable D1 test database and mocked 360dialog requests. Never point tests at a development/production database or send real messages. Focused contracts are in `whatsapp-copy-v4.test.ts`, `whatsapp-actions.test.ts`, `customer.test.ts`, `experiment.test.ts`, `360dialog-lifecycle.test.ts`, `admission-policy.test.ts`, and `whatsapp-copy-version.test.ts`.

Rollback boundary: remove the V4 catalog, its sender/enqueue/admission/action changes, binding declarations, tests, and this guide together. No migration or provider activation needs rollback. Keep this reader until any V4-snapshotted outbox rows have drained or been explicitly cancelled; never reinterpret those snapshots as V2/V3.
