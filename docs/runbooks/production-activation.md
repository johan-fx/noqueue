# Gradual production activation: GA4 and WhatsApp

This is an operator procedure, not an automatic deploy. Base configuration remains
OFF/OFF. Changes to this document do not imply activation. See the dated operations
record for actual deployed versions and gates. No staging/native/preview analytics.

## Local release and independent rollback

- `pnpm production:build` creates an OFF/OFF archive.
- `pnpm production:build --analytics landing --whatsapp off` enables only landing.
- `pnpm production:build --analytics both --whatsapp off` enables both web streams.
- `pnpm production:build --analytics both --whatsapp on` also opens approved Cloud V4.
- All snapshots are immutable-by-convention under ignored
  `queue-reports/production/releases/<id>`; manifests include source and output
  hashes, exact configuration and build variables. Never hand-edit an archive.
- The compatibility manifest pointer is not a deployment target. Use explicit IDs.
- `pnpm production:deploy --release <id> --target landing|app --confirm-production`
  requires an authorized matching Cloudflare account/token in the environment.
  Enabled features additionally require `--confirm-analytics`/`--confirm-whatsapp`.
  These flags record operator intent, not an automated proof that gates passed.
- Deployment verifies hashes/configuration and publishes archived compiled API
  bytes with `--no-bundle`; it never rebuilds current source implicitly.
- Explicit `--rollback` permits source drift only, not artifact/config tampering.
  Keep GA-OFF/WA-ON and GA-ON/WA-OFF snapshots to disable either feature separately.
  Remaining enabled features still require their confirmation flag.
- A frontend rollback cannot revoke a tag in already-open pages: arrange reload/
  PWA update delivery without clearing sessions or tickets. There is no remote kill switch.

## Mandatory gates

1. Full local tests and remote CI green; private credentials, audit captures,
   provider responses and backups stay outside Git. CI never contacts real Google.
2. A fresh encrypted backup and verified recovery procedure; no staging data import.
3. Console settings: both streams Enhanced Measurement OFF; history, scroll, clicks,
   forms, video and download detection OFF at tag level; ads/Signals/user-provided
   data/linker OFF, retention 2 months, no activity reset.
4. Isolated real-Google audit:
   `node tests/e2e/audit/real-google.mjs --release <both-enabled-id> --confirm-real-google`.
   Both production origins are routed to archived assets and an ephemeral local
   production-mode API/D1. Only Google's explicitly allowed hosts reach the network.
   Messaging uses a local-only worker with fail-closed fake transport. Synthetic
   inputs only; never load production API data into this test. Audit output is private.
   Do not accept an incomplete or failed audit as permission to activate.
5. Publish landing first, inspect actual requests and receipt ordering, then app.
   Require zero Google on rejection/excluded routes; check session/engagement events
   as well as manual page views. No tokens, raw URLs, searches or business IDs.

## Exclusive WhatsApp cutover

- Inventory all 24 selected V4 templates. Existing production URL buttons must target
  `https://app.noqueue-app.com`. `node scripts/production/templates.mjs --env-file <private-file>`
  reads/validates; only explicit `--apply` edits the 14 production URL components.
  Verify a fresh inventory after eventual consistency; preserve names/text/categories.
- Confirm balance and a bounded authorized recipient/message budget. No top-up or
  other recipients without approval. Marketing classification is not silently changed.
- Stop new staging tests; inspect pending/sending/unknown. Unknown is not delivery
  confirmation and must never be reset/replayed automatically. Preserve historic rows
  and document their disposition; production begins with an empty outbox.
- Disable staging admission/sending and remove its channel API key, verify the gates
  remotely. Do not publish a production-built frontend to staging.
- Install independent production webhook authentication plus the channel API key and
  exact phone-number ID without logging them. Generated configs deliberately omit
  the empty phone-ID variable so it cannot shadow the secret.
- Change only the channel webhook URL to the production API and preserve authenticated
  custom-header delivery. Verify the provider readback and unauthenticated rejection.
- Enable production only after staging is disabled and webhook is verified. Never
  replay old staging jobs or copy its contacts/contact windows into production.
- Test delivery, native URL button, yield/cancel quick replies, old/duplicate actions,
  STOP and re-consent with the authorized user. Count all automatic outbound replies
  against the message budget. Ask the user when real button interaction is needed.

## Known platform limits

Cloudflare NEL remains enabled by explicit user choice; Web Analytics disabled and
Zaraz empty. This is not zero technical telemetry. The 360dialog console reports
US storage and an unverified Meta business portfolio, with current 250 users/24h
limit. Do not claim EU residency for WhatsApp or unlimited production throughput.
