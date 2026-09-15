# Verify the 360dialog pilot end to end

The local vertical is runnable without a real API key. Sandbox and staging infrastructure were deployed on 2026-09-11, with **WhatsApp sending disabled**. Sandbox provider credentials, fixed-recipient allowlist and capability webhook are configured. The first authorized live smoke failed with the wrong recipient. After the user corrected the recipient, a separately authorized single smoke confirmed delivery and read status. Sending is disabled again; the user-sent BAJA opt-out is verified. Staging provider setup remains pending. No production environment is defined.

## 1. Run the isolated local proof

```sh
pnpm install --frozen-lockfile
pnpm --filter @noqueue/api test
pnpm --filter @noqueue/contracts test
pnpm --filter @noqueue/e2e exec playwright test --project=chromium
```

The browser command builds the WebApp, creates an isolated local D1 under `apps/api/.wrangler/e2e`, applies the real migrations, and starts a real Worker/DO/Queue with an MSW-intercepted 360dialog boundary. It deletes only that isolated E2E database before each run. No real provider keys are read. Open `/q/demo-queue`; the fixture pilot password is `test-pilot-access-at-least-32-characters`, recipient `+34600000000`. To explore it manually, build the WebApp and run `pnpm --filter @noqueue/api dev:e2e`.

`test/e2e-worker.ts` is not a deployment entrypoint. Its HTTP-only MSW setup includes a test-only BroadcastChannel shim because workerd lacks that WebSocket transport; the shim throws if exercised. No internal service, D1, or Durable Object is mocked. Unit/integration tests use `@cloudflare/vitest-plugin` with its supported Vitest 4.1 peer range, not Vitest 5.

For ordinary local development without fake delivery, copy `apps/api/.dev.vars.example` to `.dev.vars` in that directory, generate independent keys, apply `db:migrate:local`, and keep `WHATSAPP_ENABLED=false`. The root entry still shows the existing introduction; its continue action opens the new demo form.

## 2. Provision sandbox, then staging

**Current state (2026-09-11):** Workers Platform Admin access is effective. Both Workers, custom domains, EU D1 databases, Queue producers/consumers, DLQs, static assets and minute cron triggers are deployed in account `fa5fab4df1b0f12c946a3ea47fab96eb`. Both D1 migrations are applied. Do not recreate these resources.

| Environment | URL | D1 ID | Active version after application secrets |
| --- | --- | --- | --- |
| Sandbox | https://sandbox.noqueue-app.com/q/demo-queue | `14e31648-143e-4165-9a05-c865a09277eb` | `1edc5ab6-a3a7-496f-b499-d24d13950517` |
| Staging | https://staging.noqueue-app.com/q/demo-queue | `73a50d85-e53f-4a54-b164-07b80a39d1a8` | `1a8d6199-0785-4c62-93a2-26fd24a021ad` |

| Queue | ID |
| --- | --- |
| `noqueue-whatsapp-sandbox` | `c7abd41d449745ff833ddbf5a63afac5` |
| `noqueue-whatsapp-sandbox-dlq` | `6759b35697bd4475896bdb965771d7c0` |
| `noqueue-whatsapp-staging` | `ec627f3c84ed47cfb895f8679a8efc0d` |
| `noqueue-whatsapp-staging-dlq` | `f3e14dbc916e42e795902517da10c7cf` |

Five independent application secrets are installed in each environment: webhook token, PII encryption key, phone hash key, recovery token key and pilot access token. Private recovery copies are Git-ignored `apps/api/.env.pilot-secrets.sandbox.json` and `apps/api/.env.pilot-secrets.staging.json`, created with mode `0600`. Transfer them through an approved password manager; never attach them to chat or commit them. Do not regenerate crypto keys against existing data. The pilot form password is the corresponding `PILOT_ACCESS_TOKEN`.

**Sandbox provider configured (2026-09-11):** the user-provided Git-ignored `apps/api/.env` was restricted to mode `0600`. `D360DIALOG_SANDBOX_API_KEY` and `D360DIALOG_SANDBOX_PHONE_NUMBER` were validated privately and mapped to remote `D360DIALOG_API_KEY` and `WHATSAPP_RECIPIENT_ALLOWLIST` using protected stdin. No existing application key was replaced. The provider returned an empty webhook configuration before registration; POST and subsequent GET both returned `200`, with the persisted URL matching the intended capability route. The unauthenticated application webhook still returns `401`. No send endpoint was called and no join was created during setup.

**First live smoke (2026-09-11): FAILED, no resend.** After the user confirmed ordinary inbound text, enabled only Sandbox, issued one authenticated public join through the existing smoke script, and restored `WHATSAPP_ENABLED=false` after its terminal failure. The stable idempotency key and run timestamps remain in Git-ignored `apps/api/.wrangler/smoke-sandbox-run.json` (mode `0600`); do not replace the key or rerun the script without a new operator decision.

Redacted remote evidence after shutdown:

- Two queue entries total: the earlier no-consent synthetic entry plus this one consenting entry.
- Exactly one outbox row: `failed`, `attempts=1`, no provider ID, no DLQ copy and no pending notification.
- One consent, not yet revoked; zero normalized webhook events. Delivery and STOP/BAJA are **not verified**.
- Provider webhook configuration GET remains `200` and matches the intended capability route; all seven expected Worker secret names remain present.
- API typecheck, WebApp build and Sandbox deployment dry-run passed before activation. Sandbox shutdown deployment completed; staging was not modified.

The deployed adapter discarded the HTTP status and provider error code, so the cause of this first failure is **unknown** and cannot be recovered from D1. It is not proven to be credentials, recipient, session window or permissions. A local diagnostic fix now emits only `whatsapp_send_failed`, a static reason (`configuration` or `http_rejection`), HTTP status and a numeric provider error code (or `null`). Bodies remain bounded to 64 KiB; text, headers, phone numbers and recovery links are never included. No schema migration or additional URL-capturing logs are introduced. The fix was subsequently deployed during the separately authorized corrected-recipient smoke; 36 API tests and typecheck pass, including terminal statuses, invalid/oversized bodies, privacy, and unchanged retry bounds. The original failed response remains irrecoverable.

**Corrected-recipient smoke (2026-09-11): PASS.** The user clarified that the recipient variable had contained the public Sandbox service number, corrected it to their own test number, and sent fresh ordinary inbound text. After the allowlist-only update and separate authorization, one new public join produced exactly one provider attempt. The guarded smoke confirmed `delivered` via the recovery API; subsequent D1 inspection confirmed `read`. One each of `sent`, `delivered` and `read` callbacks was persisted and processed. The former failed attempt remains unchanged and was not retried.

Final aggregates: three entries total, two outbox rows (old `failed` with attempts=1/no provider ID; new `read` with attempts=1/provider ID present), two unrevoked consents, no pending notifications. The new private identity is Git-ignored `apps/api/.wrangler/smoke-sandbox-corrected-recipient.json` (mode `0600`); the old run-state file remains untouched. No credential, phone, recovery token or provider ID was included in evidence. Typecheck and Sandbox dry-run passed before deployment; existing assets were reused.

Sandbox was disabled again immediately after provider acceptance, while webhook/recovery processing continued. Remote version readback confirms `WHATSAPP_ENABLED=false`, the recipient allowlist and all seven secret bindings. No staging changes, API-key rotation, webhook rotation, simulated opt-out or second provider attempt occurred.

**Manual BAJA verification (2026-09-11): PASS.** After the user confirmed sending `BAJA` from the corrected tester phone, read-only remote checks found one matching `opt_out` webhook persisted and processed. HMAC-scoped lookup confirmed the tester's one `demo-org` / `queue_updates` consent revoked, zero active tester consents and zero pending/sending tester notifications. The successful notification remains `read` with attempts=1 and provider ID present. Its private recovery API returns `200`, turn status `waiting`, and valid position/ETA. The old failed notification remains unchanged with attempts=1; its unrelated wrong-recipient consent must not be confused with the tester's revoked consent.

Remote version readback confirms sending remains disabled at `1edc5ab6-a3a7-496f-b499-d24d13950517`. Verification sent no messages, created no synthetic callback, performed no manual revocation, and changed no remote configuration or staging resources. There were no pending messages at opt-out time, so live cancellation of an already-pending message was **not exercised** (covered by automated tests only).

**Still required:** staging provider key, recipient allowlist, webhook, business phone-number ID, approved templates and client-approved consent before its separately authorized smoke. Both environments remain disabled; no new Sandbox sends are needed to complete this delivery/opt-out proof.

**Initial infrastructure verification (before the live smoke):** type generation, typecheck, lint, 33 tests (24 API freshly executed; remaining tests reused valid Turbo cache), build, both environment deployment dry-runs and two Chromium E2E tests. Remote HTTPS health and demo HTML return `200`; unauthenticated joins and webhooks return `401`. A single authenticated no-consent entry per environment returned `201`, replay returned `200` with the same private token, and recovery returned `200` with notification `disabled`. At that point each database retained one synthetic turn; those initial checks supplied no real phone or consent. Staging initially had a local negative DNS cache; HTTPS validation through public DNS retained hostname/certificate verification.

### Provisioning recipe for future recovery

The commands below document initial creation, not a next action. Inventory the account and reuse the above resources; never run create commands blindly.

In `apps/api`, select the confirmed owning account explicitly. For each `ENV=sandbox` and later `ENV=staging`:

```sh
export CLOUDFLARE_ACCOUNT_ID=fa5fab4df1b0f12c946a3ea47fab96eb
pnpm exec wrangler d1 create noqueue-$ENV --jurisdiction eu
pnpm exec wrangler queues create noqueue-whatsapp-$ENV
pnpm exec wrangler queues create noqueue-whatsapp-$ENV-dlq
```

The remote `database_id` values and confirmed `account_id` are now recorded in `wrangler.jsonc`; only the local default retains its all-zero placeholder. For any approved new environment, use its returned ID, never a guessed one. Never deploy the local default config. Queues do not expose the D1/DO EU jurisdiction guarantee: their payloads contain opaque identifiers only; do not represent the entire stack as EU-resident. DO routing explicitly uses the EU jurisdiction remotely; local workerd does not implement jurisdiction restrictions.

Set each secret independently using protected stdin or Wrangler's interactive prompt, never command-line literals:

| Secret                         | Value                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `D360DIALOG_API_KEY`           | Environment's provider key                                                                       |
| `D360DIALOG_WEBHOOK_TOKEN`     | Random, at least 32 characters                                                                   |
| `PII_ENCRYPTION_KEY`           | Independent 32 random bytes encoded as 64 hex characters                                         |
| `PHONE_HASH_KEY`               | Independent 32 random bytes encoded as 64 hex characters                                         |
| `RECOVERY_TOKEN_KEY`           | Independent 32 random bytes encoded as 64 hex characters                                         |
| `PILOT_ACCESS_TOKEN`           | Independent random password, at least 32 characters                                              |
| `WHATSAPP_RECIPIENT_ALLOWLIST` | Comma-separated E.164 internal recipients; exactly the Sandbox key's fixed recipient for sandbox |

Example command shape: `pnpm exec wrangler secret put PII_ENCRYPTION_KEY --env sandbox`. Secrets put deploys a version; provision resources and confirm the target first. Generate hex keys with `openssl rand -hex 32` in a private terminal. Do not save outputs in tickets, chat, logs, screenshots, or tracked files. The private ignored recovery copies described above must stay mode `0600` and be handed over through an approved password manager.

Then:

```sh
pnpm exec wrangler d1 migrations apply DB --remote --env "$ENV"
pnpm cf-typegen
pnpm check-types
pnpm --filter @noqueue/web build
pnpm exec wrangler deploy --dry-run --env "$ENV"
pnpm exec wrangler deploy --env "$ENV"
```

The migration seeds one organization, venue and `demo-queue` (capacity 20 waiting entries, average five minutes). Configure custom domains `sandbox.noqueue-app.com` and `staging.noqueue-app.com`. Keep the two environments' resource IDs, keys, recipients, webhooks and D1 data separate. Only after preflight set the relevant `WHATSAPP_ENABLED` to `true` and redeploy.

## 3. Register the correct webhook

| Environment | Registration                                                                                                                                                   | Authentication            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Sandbox     | `POST https://waba-sandbox.360dialog.io/v1/configs/webhook` with `{ "url": "https://sandbox.noqueue-app.com/api/v1/integrations/360dialog/webhook/<secret>" }` | Opaque capability path    |
| Staging     | `POST https://waba-v2.360dialog.io/v1/configs/webhook` with URL `/api/v1/integrations/360dialog/webhook` and configured custom header                          | `X-NoQueue-Webhook-Token` |

Both provider configuration calls require `D360-API-KEY`. Use a protected local script or API client that reads secrets from its environment; never paste the expanded capability URL into a shared command, chat, monitoring service or request-bin site.

The current Sandbox docs expose only the `url` field and **do not promise custom headers**. This implementation therefore uses a capability URL only for Sandbox. Cloud mode rejects capability routes and requires the header. If your security policy forbids URL secrets, use a trusted authenticated relay or verify custom-header support before using Sandbox; do not remove webhook authentication.

Worker invocation logs and traces are disabled to avoid leaking capability paths, recovery URLs, and personal data. Structured explicit event codes remain enabled. Do not enable URL-capturing access logs, traces, analytics or tail collection until redaction is proven. Set no-referrer and no-store on public recovery API responses; the HTML also declares no-referrer. Treat recovery links as credentials.

Only a durably stored supported webhook is acknowledged; D1 errors return 503 and provider retry can recover them. Unknown authenticated payloads are acknowledged without storing body contents. Repeated events deduplicate. Status events that precede the send response stay pending until their provider ID is known.

## 4. One-message Sandbox smoke

1. Use a **phone-shared** Sandbox account with a fixed E.164 recipient. BSUID-only accounts are not supported by this v1 contract.
2. With an existing valid key, send ordinary non-opt-out text to the official Sandbox number to open the session; do not request another key with `START`. Confirm the current key belongs to the intended fixed recipient. Every messaging request counts toward the provider's 200-request Sandbox limit, including rejected requests.
3. Register the authenticated webhook and independently verify it receives a test inbound message. Do not change it during smoke execution.
4. Put `SMOKE_RECIPIENT`, `SMOKE_PILOT_TOKEN`, and a UUIDv4 `SMOKE_IDEMPOTENCY_KEY` in your private process environment. Keep the same idempotency key until the outcome is resolved. Never run concurrent smokes from multiple machines.
5. Run:

```sh
pnpm --filter @noqueue/api smoke:360dialog -- --target sandbox --confirm-send
```

The script issues exactly one public join POST, then polls its private recovery API for up to two minutes. It prints no phone, provider ID, recovery token, or API key. `accepted` alone is not success; Sandbox requires `sent`, `delivered`, or `read`. A network timeout is ambiguous; retain the idempotency key and investigate before creating another entry. Local lock directories serialize operators on this machine only.

**Manual opt-out proof:** after delivery, send `STOP` or `BAJA` from the recipient. Use the matching D1 console to confirm `consent.revoked_at` is populated and pending notifications are `cancelled`. Already delivered messages retain their delivery state. Save only redacted counts/states as evidence, not rows containing sensitive data. The automated smoke output explicitly does not claim this manual step succeeded.

## 5. Staging real-number gate

Create `noqueue_queue_joined` Utility templates in `es_ES` and `en_US`. Body parameters, in order: venue name, opaque entry code. A URL button uses `https://staging.noqueue-app.com/t/{{1}}`; its parameter is the opaque recovery token. Do not include phone numbers or changing queue positions. Use a client-approved neutral consent notice before enabling staging: replace the provisional copy/version in the shared contract and UI, review it with the client, then set `STAGING_CONSENT_APPROVED=true`. Never set this gate merely to make a test pass.

Set staging `D360DIALOG_PHONE_NUMBER_ID` to the registered business number ID (not the E.164 phone). Cloud callbacks carrying another number ID are rejected; missing configuration returns 503.

Verify Meta reports both templates `APPROVED`, the real number can send, the correct webhook is installed, and the internal recipient has consented. Set `SMOKE_STAGING_APPROVED=true` only after this checklist, then:

```sh
pnpm --filter @noqueue/api smoke:360dialog -- --target staging --confirm-live-send
```

Staging requires `delivered` or `read`. Also open the private link on the device to prove recovery and repeat manual STOP/BAJA verification. No automated test should use the real number or its keys.

## Delivery, operations and cleanup

- Hono → per-queue DO serialization → atomic D1 batch → identifier-only Queue job → `fetch` adapter. Messaging never rolls back a confirmed entry.
- D1 and Queue are not a distributed transaction. The minute sweep republishes pending IDs, retries safe rate limits and reconciles early callbacks. Consumers claim `pending → sending` with compare-and-set.
- Only an explicit rate-limit rejection is retried (maximum three send attempts, exponential delay and jitter). Timeout, network failure, invalid successful receipt and provider 5xx become `unknown`; no blind resend. A process that dies in `sending` becomes `unknown` after two minutes. Without a provider ID, an ambiguous send cannot be automatically correlated: operator investigation is required.
- The DLQ stores opaque jobs. Safe-retry exhaustion is copied once in the happy path; duplicate DLQ records remain possible across a publisher crash. Never redrive ambiguous or accepted entries as new sends. Alert on `unknown`, DLQ backlog and old `pending` rows.
- Opt-out blocks pending delivery and revokes active queue-update consents, but cannot recall a request already in flight. Inbound timestamps have one-second precision.
- Code/position/ETA are demo-only. No staff lifecycle exists, so waiting entries do not leave automatically. After each pilot, disable sending; export only aggregate evidence; then delete demo entries through a reviewed environment-specific D1 operation. Child contact/consent/event/outbox rows cascade. Delete webhook events separately (including unmatched statuses) after investigation, no later than seven days. The pilot currently relies on this manual retention step.
- API-key rotation uses the newest number-specific key; update the matching Worker secret and run one smoke. Cryptographic-key rotation is **not** blind replacement: changing encryption, phone-hash or recovery keys invalidates existing encrypted contacts, lookups or links. Drain/delete the pilot data first or implement versioned key migration before rotating these keys.
- Rollback boundaries: remove the whole pilot route/UI/worker jobs together; retain D1 and keys until delivery/opt-out investigation ends. Never roll back by dropping a live notification table. No commits or production deployment are part of this delivery.

## References

- [360dialog Sandbox](https://docs.360dialog.com/docs/get-started/sandbox)
- [360dialog webhooks](https://docs.360dialog.com/docs/messaging/webhook)
- [Cloudflare Queues JavaScript API](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
- [Durable Object namespace / jurisdiction](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
