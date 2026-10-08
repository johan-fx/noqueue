# WhatsApp queue lifecycle notices

This runbook describes the version-2 lifecycle used for public restaurant,
reception and pool queues. It covers admission, notice policy, recovery links,
diagnostics and rollout prerequisites. It does not certify legal copy, provider
templates, or production delivery.

## Admission and consent

Every new public service/queue admission requires an international-format phone
number (`+` followed by 8–15 digits) and an unchecked-by-default, explicit
WhatsApp consent. The current consent text is versioned as
`whatsapp-public-service-updates-v1` and presents the configured LUMOSA S.A.
data-controller information in Spanish and English. A version string and
existing text are not evidence of legal approval: validate the wording, purpose,
retention, contact details and applicable legal basis before public rollout.

The legacy public queue endpoint applies the same rule for new entries. Its
idempotent replay path recovers a previously committed request before admission
guards; a payload without consent cannot create a new real entry. Server-local
loopback development and test cases are the only documented no-consent
exceptions. Missing WhatsApp/provider configuration or an unapproved recipient
blocks a new real admission; a later send failure never rolls back a committed
queue entry. `STOP` and `BAJA` stop further notices for the contact; they do not
remove the customer from the queue.

## Notice policy and message matrix

The staff-facing queue form keeps the main surface compact. Detailed settings,
including the existing approach thresholds, grace period and estimate-change
controls, live in the existing **Configuración avanzada** drawer. A changed
notice policy with active waiters requires confirmation before applying it;
grace changes affect future assignments, not already-snapshotted deadlines.

| Notice | Trigger | Included information and destination |
| --- | --- | --- |
| `queue_joined` | New committed, consenting entry | Venue, service, queue code, turns ahead, best available estimate, recovery link |
| `approaching` | Waiting entry reaches the configured approach threshold; it is still unassigned | Calm “approaching, not assigned” wording, turns ahead, estimate, recovery link |
| `delayed` / `improved` | Known predicted attention time moves later/earlier by at least the configured absolute threshold | New estimate and recovery link; ordinary countdown movement is not a change |
| `ready` | Actual call/assignment | Venue/service/code, actual allocated zone/resource when known, arrival deadline and recovery link; never the preferred zone as though it were assigned |
| `expired` | The snapshotted arrival deadline expires | Rejoin instruction and recovery link |
| `cancelled` | Customer or staff cancels | Copy distinguishes who cancelled; entry recovery link |
| `service_ended` | Service closes with waiting entries | Service-ended copy and rejoin link |

Yield remains an on-screen action after the server confirms the updated state.
Arrival, normal service completion and restaurant-table release do not create
additional WhatsApp notices. `ready` represents the actual assignment/call
notice; it is not sent merely because the customer is near the front.

Defaults preserve the current approach policy: notify at 2 turns ahead or
within 10 minutes. The material estimate-shift threshold defaults to 5 minutes
and the correction-notice cooldown to 10 minutes; both are configurable. A
correction compares the current `predictedAt` against the last provider-accepted
prediction, not against elapsed countdown time. Only an accepted correction
advances that baseline. Pending, failed or unknown sends do not. Unknown ETAs
do not produce delay/improvement notices, and updates during the cooldown are
coalesced to the latest current estimate for reevaluation afterward.

Arrival grace is configurable and defaults to 5 minutes for restaurants and 2
minutes for reception/pool. The server snapshots the arrival deadline when an
entry is assigned. Delivery, retries and later grace changes do not extend it;
legacy assignments without a deadline are not retroactively expired.

## Templates, links and delivery

Version-2 Cloud API sends select a versioned template for the exact notice kind
and locale. Configure the approved provider-side name in the matching binding;
there is no fallback from a missing v2 template to the legacy joined template.
The sandbox uses the same notice/context model to render its own text copy.
Template names below are configuration keys only; this repository does not
create or edit provider templates.

| Notice | Spanish | English |
| --- | --- | --- |
| Joined | `WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_EN` |
| Ready | `WHATSAPP_QUEUE_V2_READY_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_READY_TEMPLATE_EN` |
| Approaching | `WHATSAPP_QUEUE_V2_APPROACHING_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_APPROACHING_TEMPLATE_EN` |
| Delayed | `WHATSAPP_QUEUE_V2_DELAYED_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_DELAYED_TEMPLATE_EN` |
| Improved | `WHATSAPP_QUEUE_V2_IMPROVED_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_IMPROVED_TEMPLATE_EN` |
| Expired | `WHATSAPP_QUEUE_V2_EXPIRED_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_EXPIRED_TEMPLATE_EN` |
| Cancelled | `WHATSAPP_QUEUE_V2_CANCELLED_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_CANCELLED_TEMPLATE_EN` |
| Service ended | `WHATSAPP_QUEUE_V2_SERVICE_ENDED_TEMPLATE_ES` | `WHATSAPP_QUEUE_V2_SERVICE_ENDED_TEMPLATE_EN` |

The v2 body parameter contract is service name, queue code, turns ahead,
estimate, actual resource, arrival deadline and cancellation reason. Missing
position/estimate/resource/deadline data is represented explicitly as
unavailable or by the recovery-link fallback, never invented. The URL button
uses the recovery token plus locale, `source=whatsapp` and the notice UUID. The
browser HTTPS route remains the fallback; native `/v`, `/q` and `/t` paths
require the separate Apple/Android association and signing configuration before
Universal/App Links are considered live.

The outbox stores an immutable, versioned payload snapshot and notice revision.
Before dispatch, pending notices are checked against the current entry phase,
call cycle, policy and estimate; obsolete pending notices are cancelled or
replaced. Joined and approach notices for the same immediate state are
consolidated. Ready and terminal notices are not delayed by correction
cooldown. Existing bounded retries remain; an unknown provider outcome is not
automatically resent because the provider may already have accepted it. Track
**accepted** separately from provider **sent/delivered/read**, failed and
unknown outcomes.

## Configuration and observability

Cloud sends require the existing WhatsApp enablement and recipient allowlist,
valid provider bindings, the applicable consent-approval gate, the v2 template
approval gate and an approved v2 template for every used kind/locale. Public
admission readiness also checks the joined template for the selected locale.
Keep these gates disabled until migration, compatible admission forms, legal
review, external template approval/configuration and the intended recipient
scope have all been verified. A local config file or passing test does not
prove any remote setting or actual delivery is ready.

Apply the additive `0015_whatsapp_lifecycle_v2.sql` and then
`0016_whatsapp_accepted_notice_order.sql` migrations through the release's
normal database process before deploying code that uses v2 snapshots and
accepted-notice ordering. Local tests use isolated D1 and mock/sandbox providers; they do not
apply migrations to a shared database or send real messages.

Open **Configuración avanzada → Trazabilidad de avisos (7 días)** for protected
per-kind accepted, sent, delivered, read, failed, unknown and link-opening
counts, plus recent status events. Opening telemetry means the recovery link
was opened; it is not proof the customer read the message. Evidence uses safe
status/error codes and timestamps, not phone numbers, recovery tokens or
message bodies. No currency cost estimate is shown without an authoritative
tariff source.

## Release and rollback boundary

Do not enable public admission until the v2 migration is applied, all deployed
forms send the required phone/consent fields, the bilingual legal text has been
validated, required templates are approved and configured, recipient scope is
verified, and external app-link association is configured if native opening is
expected. `WHATSAPP_ENABLED=false` stops new notices and, outside the documented
loopback exception, prevents new real WhatsApp-required public admissions; it
does not disable reads of existing turns or staff queue operations.

Deploy the coordinated API, UI, contracts and migration behavior together.
The schema change is additive: an application rollback may leave the migration
in place, but must not drop historical queue, consent, outbox, allocation or
delivery-trace data. Legacy outbox rows retain their v1 payload/template path;
do not rewrite already queued/history rows as v2.
