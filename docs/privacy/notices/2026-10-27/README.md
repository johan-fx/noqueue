# Mobile privacy notice — 27 October 2026

Document revision 2 expands the shared ES/EN notice for mobile queue ownership,
optional location/search/QR, FCM/APNs, WhatsApp, operational metrics, retention and
rights requests. The previous copy is archived next to this file.

This is **not** a change to GA purposes, providers or consent choices. The consent
protocol remains `PRIVACY_REVISION = 1`; existing consent is not invalidated.

## Public deletion route

`https://noqueue-app.com/privacy/#delete-data` links prominently to the email
procedure at `hola@noqueue-app.com`. No guest account, reinstallation, password,
private ticket URL or notification token is required. Do not request identity
documents by default. Verification must be proportionate and limited to locating
and protecting the requester's data.

This documents a **manual rights-request process**, not an implemented automatic
purge or a new API. The owner has confirmed this mailbox will handle requests.
For each request, the responsible operator must:

1. Log receipt, scope and the one-month response deadline; restrict access.
2. Locate the relevant records using minimal information, and verify ownership.
3. Assess queue data, phone if present, installation associations, push tokens,
   personal operational records and relevant processors/venue responsibilities.
4. Determine lawful retention exceptions and document their actual duration or
   criteria. Consider existing backups and prevent deleted data from being
   reintroduced by a later restore. Do not promise a backup expiry not enforced.
5. Perform separately authorised, verified removal/restriction using an approved
   operational procedure; this notice change does not authorise any deletion.
6. Reply with the outcome, exceptions and complaint rights. Notify any justified
   extension within the first month (up to two additional months).

A blanket 90-day queue/name purge does not exist. Uninstalling or cancelling a
queue ticket does not delete server records. Detailed retention limits, backup
expiry and the legal basis for operational statistics warrant owner/legal review;
this technical publication is not a legal-compliance certification.

## Scope and verification

- Six landing tests, twelve shared privacy tests and privacy TypeScript check pass.
- Public HTTPS and browser ES/EN checks verify the notice, anchor and mailto link.
- Only `privacy/index.html` was changed in the deployed static asset package.
- All other assets, including GA configuration and consent JS, were preserved
  byte-for-byte from the active landing release and checked via HTTPS.
- Base landing version: `f25a0f93-57de-47c8-80d4-196d2d9d0aa5`.
- Updated landing version: `dd54429d-9176-4586-93a8-d4609780a414`.
- User specifically authorised publication of this policy web update only.
- No app/API/mobile deployment, message, database change or store release.
- Existing build 1009's embedded policy is not rewritten by a website deployment;
  the stores' external policy URL receives this update immediately. The shared
  source will be included in a future separately authorised app build/deployment.
- Evidence/snapshot: `output/mobile/production-1009/privacy-web-evidence/`
  (local ignored audit files; do not commit personal operational backups).

Rollback, if separately authorised, is scoped to `noqueue-landing` and its apex
custom domain; do not roll back the API or alter DNS/email records.
