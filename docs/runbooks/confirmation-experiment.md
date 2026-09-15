# Staff-assisted confirmation — EXPERIMENT

Not a production staff console or a production consent notice. The isolated queue supports three synthetic entries (no phone/consent/messages) and **one own-phone tester at a time** on a shared queue. Private participants may use their own phones only when the explicitly authorized staging recipient-expansion flag is enabled. Existing demo data and ordinary joins are separate.

## Real staging: user steps

1. Abre [el experimento](https://staging.noqueue-app.com/api/v1/experiments/confirmation) e introduce el acceso privado al piloto. Comparte ese acceso solo con los participantes por un canal privado; nunca lo pongas en una URL.
2. Pulsa **Preparar tres turnos**. Son turnos ficticios sin teléfono delante del tuyo.
3. Introduce **tu propio teléfono**, el número de personas y la autorización previa para este primer contacto. Pulsa **Crear turno y solicitar CONFIRMO**.
4. Abre tu WhatsApp real. Pulsa el botón **CONFIRMO** o responde **CONFIRMO** al mensaje de NoQueue. Espera a que el navegador muestre **Avisos activados**.
5. Pulsa **Avanzar un turno**. Tu posición pasa de 4 a 3 y recibirás que quedan 2 turnos delante. Otro avance indica que queda 1 turno; el siguiente, que eres el siguiente. **No significa que la mesa esté lista**.
6. Envía **BAJA** desde WhatsApp. El estado pasa a **Baja registrada**; puedes avanzar la cola sin recibir nuevos avisos. Ni CONFIRMO ni reiniciar reactivan un teléfono dado de baja en este experimento.

No confundas **Aceptado por WhatsApp** con entrega real. Si aparece **Resultado incierto**, **no reenvíes**: el resultado es incierto. Si falla la respuesta del navegador, repite la misma acción sin cambiar sus datos; conserva la misma clave mientras la página siga abierta.

La cola es compartida: coordina una prueba cada vez. **Reiniciar la prueba** pide confirmación porque cancela los turnos y avisos pendientes de otra persona. BAJA sigue activa después del reinicio.

## Activation checklist — operator only

All checked-in environments default to sending/experiment **off**. Never deploy `test/e2e-worker.ts`. Deploy the normal `src/index.ts` Worker and web assets. Apply the new `0004_live_queue_experiment.sql` migration after 0002/0003; never rewrite applied migrations.

Staging activation requires all of:

- `APP_ENV=staging`, `WHATSAPP_MODE=cloud`, `WHATSAPP_ENABLED=true`, `CONFIRMATION_EXPERIMENT_ENABLED=true`, `STAGING_EXPERIMENT_APPROVED=true`.
- Keep **`STAGING_CONSENT_APPROVED=false`**: it controls ordinary joins with a different notice/template, not this experiment.
- Real `D360DIALOG_API_KEY`, private `PILOT_ACCESS_TOKEN`, independently generated PII/hash/recovery keys. Preserve `WHATSAPP_RECIPIENT_ALLOWLIST` for ordinary routes; never wildcard or delete it. No provider key ever reaches the browser. Pilot access stays in page memory, not browser storage.
- For the explicitly requested shared client/team test, add **`STAGING_EXPERIMENT_OPEN_RECIPIENTS=true`** as a deployment override. It bypasses the allowlist only for authenticated enrollment in `confirmation-experiment` and its confirmation/position outbox kinds, with all live staging gates enabled. False retains the previous recipient restriction. Access is not consent; participants must use their own phone and authorize contact. This is not bulk messaging, and real messages can incur charges.
- Preserve all currently authorized **live overrides** on redeployment: the checked-in false values are safe defaults, not the desired live state. Do not shut down the active pilot while publishing a UI-only update.
- Verified `D360DIALOG_PHONE_NUMBER_ID`; authenticated provider webhook to `/api/v1/integrations/360dialog/webhook` with `X-NoQueue-Webhook-Token` matching the secret. Do not put webhook/pilot credentials in URLs.
- Confirm both channel and WABA webhook configuration before sending. Delivery/confirmation cannot work while webhook configuration is absent. Real sends/deployment require their own operator authorization.
- Approved immutable template **`noqueue_queue_optin_confirm_pilot_v3`**, UTILITY, locale **`es`**, static header `Hola!` (no header parameters), one body reference parameter, QUICK_REPLY `CONFIRMO` index `0`. Preflight verified this shape; earlier v1/v2 rejection does not apply to v3. Do not substitute the ordinary queue-joined template.

This implementation run itself does not prove real delivery. Browser/runtime tests substitute only the external provider boundary.

## Safety and persistence contract

- The queue Durable Object serializes enrollment, reset, advance and dispatch, including in-flight HTTP. Each mutation uses a UUID idempotency key; D1 batches commit state/events/outbox/action records together.
- Reset cancels pending messages, revokes the previous experiment's consent and retires its entries. It never deletes old receipts, uncertain outcomes or STOP suppression. Seed retries cannot create extra placeholders. One waiting tester and capacity four prevent uncontrolled fan-out; mutations share the pilot's 30/minute bound.
- Prior authorization grants `confirmation_contact` only. Matching confirmation switches to `queue_updates`. Button correlation requires phone hash + payload + provider message ID; text CONFIRMO requires one unambiguous pending request. Confirmation expires after 15 minutes. Failure/expiry/BAJA does not itself remove the turn.
- Every advance serves the actual front entry and recalculates waiting positions. At most one update is enqueued per advance, only for a waiting confirmed non-revoked tester. Pending snapshots coalesce to the latest; stale/non-waiting snapshots are cancelled at dispatch.
- Position messages are freeform only inside 24 hours of the last authenticated inbound message, checked again at dispatch. Unrelated inbound text renews that window but never grants consent. Expired windows block sends, never reuse the opt-in template.
- A hashed STOP latch is persisted at webhook ingress before asynchronous processing. It blocks new enrollment and sends even before consent revocation runs. Late CONFIRMO/reset cannot clear it. An external request already started cannot be recalled.
- Ambiguous timeouts/5xx remain `unknown`, with no blind retry. An unknown position send blocks later positions for that entry so a delayed old message cannot be knowingly overtaken. Unresolved sends also block re-enrollment of that phone after a reset. Only explicit rate-limit rejection can retry (bounded). Provider delivery order after acceptance remains outside application control.
- Contacts remain encrypted; hashed metadata drives correlation/window/suppression. No message body or raw provider error text is persisted/logged. Existing retention/cleanup must respect the suppression latch.

## Local simulation and checks

Use Node 22.19+ and pinned pnpm; prevent local real-key loading:

```sh
export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
pnpm --filter @noqueue/web build
pnpm --filter @noqueue/api dev:e2e
```

The disposable harness resets `.wrangler/e2e` state and blocks unmatched external requests. The new deployable page is also available at `/api/v1/experiments/confirmation` in this **simulated** local harness; no real WhatsApp is sent there. Local fixture access is `test-pilot-access-at-least-32-characters` and fixture phone `+34600000000`. The older dual-role simulator remains at `/api/v1/experiments/local/confirmation`. Both use real local DO/D1/domain code; only delivery and inbound callbacks are simulated. Test-only customer controls never exist on staging.

```sh
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false pnpm --filter @noqueue/api test
pnpm --filter @noqueue/api check-types
pnpm --dir tests/e2e exec playwright test specs/real-experiment.spec.ts --project=chromium
```

To stop the pilot, disable `WHATSAPP_ENABLED` and `CONFIRMATION_EXPERIMENT_ENABLED` without altering consent evidence. Restore neither settings nor keys automatically. Preserve migrations and prior vertical/landing work; rollback requires compatible code for the multi-message outbox schema.

## Staging activation evidence — 2026-09-13

- Normal `src/index.ts` deployed only to `noqueue-api-staging`, version `d352c125-bd75-4b5a-a785-6a1505b9b229`. Remote migrations 0001–0004 are applied.
- Sending, confirmation experiment and staging experiment approval are enabled through deployment-time variable overrides. Ordinary `STAGING_CONSENT_APPROVED` remains **false**. Checked-in defaults remain off; an ordinary redeploy without these overrides disables the experiment.
- Real provider key and one own-phone allowlist installed through protected stdin. Existing application encryption/hash/recovery/webhook/pilot secrets were preserved. Obtain pilot access privately from `PILOT_ACCESS_TOKEN` in the ignored `apps/api/.env.pilot-secrets.staging.json`; never publish its value.
- Channel webhook URL and authentication header were configured and read back successfully. WABA-level configuration was not changed. Provider health was LIMITED (pending display name/business verification), with WABA AVAILABLE; this is not delivery proof.
- Read-only checks: experiment page 200; state without token 401; state with private token 200 and empty entries; local simulator route 404. Final outbox count and total send attempts both **0**. No joins, seeds, advances, synthetic inbound callbacks or real messages were performed.
- Python urllib requests encountered Cloudflare error 1010; curl verified the application responses above without changing any security settings.

### Guided UI and scoped recipient expansion — 2026-09-13

Staging version `4476290c-8163-43e1-b844-675964fcc79d` adds the guided interface and the explicitly authorized `STAGING_EXPERIMENT_OPEN_RECIPIENTS=true` override. Prior live overrides remain active; ordinary consent stays false. Existing allowlist and all other secrets are unchanged. Expansion applies only to authenticated staging experiment confirmations/position updates, not ordinary joins or other queues. No migrations or web asset changes were required.

Read-only verification: updated page 200, unauthenticated state 401, authenticated state 200, local simulator 404, webhook unchanged. Outbox records/attempts remained 4/4 with zero pending, sending or unknown notifications. No messages or queue mutations were performed during this deployment.
