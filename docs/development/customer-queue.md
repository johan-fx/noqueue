# Public restaurant waiting list

Guests use `/v/:venueId` to choose a real service, `/q/:queueId` to join, and a private `/t/:recoveryToken` link to recover their turn. Restaurant forms and turn states live in the customer feature; reception, pool, and demo flows keep their existing forms.

## Release checklist

1. Apply additive D1 migration `0009_customer_queue.sql` before deploying the API code. No migration or deployment is performed by this change.
2. Deploy the API/coordinator and web client together. Existing response fields remain compatible; new customer context is optional.
3. Check a restaurant call has a persisted deadline and a coordinator alarm. Keep the minute cron enabled as alarm recovery.
4. Verify late arrival expires and frees its allocation. Legacy calls with a NULL deadline remain manual.

## Behavior and boundaries

| Behavior    | Invariant                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approaching | At most 2 turns ahead OR at most 10 known estimated minutes by default. Unknown estimates never count as zero. Changing thresholds with waiting entries requires explicit confirmation.                           |
| Editing     | Name, party size, and space change, but age and sequence do not. A stale version cannot overwrite a staff call.                                                                                                   |
| Yield       | Swap with the next compatible waiting party using shared eligible resources. Incompatible intermediate entries retain their order. Both versions and events update atomically. Staff skip still moves to the end. |
| Arrival     | Staff confirms arrival. `completed` and subsequent `served` retain the recorded arrival date.                                                                                                                     |
| Expiry      | New restaurant calls freeze their deadline. Expiry wins at the deadline, releases the allocation once, and is independent of browser activity. Grace changes only affect future calls.                            |
| Correction  | Authorized staff restore an expired turn with an audit reason. Recall may use a released allocation row, but cannot take an occupied resource.                                                                    |
| Recovery    | Commands are bound to the hashed private token and use versioning plus an idempotency key. A lost response can be retried without repeating a mutation. Names remain encrypted; fingerprints use HMAC.            |
| Networking  | Turn polling every 3 seconds, with focus/visibility refresh. Errors preserve the last snapshot and its timestamp. The browser never expires or confirms arrival on its own.                                       |

The venue API contains only public service metadata, summed party sizes, and the average of known waiting estimates. No estimate is rendered as zero when there is no supporting data. No phone, WhatsApp consent, notification integration, remote execution, or deployment is added.

## Verification units

- Customer commands, projection, expiry, migration, and coordinator: API integration tests; removing this unit requires reverting the customer API/routes and coordinator integration together. Keep the additive migration in an already-migrated database.
- Customer interface and navigation: React tests and `customer-queue.spec.ts`; removing this unit restores previous route components without changing staff operations.
- Staff configuration and correction: opening/command tests and existing staff E2E flows; revert the corresponding contract/action controls together.
- Visual fixtures cover selector, join, waiting, approaching, yield sheet, called, arrived, expired, and cancelled at 390px. Fixture screenshots are QA evidence, not implementation assets.

Run `pnpm --filter @noqueue/api test`, `pnpm --filter @noqueue/web test`, `pnpm check-types`, and the Chromium E2E specs `queue-services.spec.ts`, `queue-verification.spec.ts`, and `customer-queue.spec.ts` with one worker. Also run the customer spec in WebKit.
