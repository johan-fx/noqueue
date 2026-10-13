# Establishment logos

## Delivery status

The repository configures local/test R2 plus **planned** sandbox/staging bindings.
No bucket, DNS record, header rule, migration on a remote DB or deployment is
created by this change. Remote activation is a separate, explicitly approved
operation. There is no production environment in the current Wrangler config;
do not treat its top-level local config as production.

## Data and authorization

Logos belong to `venue`, not Better Auth `organization.logo`. Migration
`0025_venue_logo.sql` adds an independent `logo_version`, object tracking and
committed-request idempotency records. Existing establishments start at null/0.
The existing location version and location/queue grants do not change.

- Owners: active venue membership, corresponding organization membership and an
  active tenant. Managers, queue staff and viewers can read but not mutate.
- Commercial: only tenants created by that actor; platform admin: any tenant.
  Their existing administrative access to suspended tenants is preserved.
- Every mutation requires the normal session, allowed Origin, rate limit,
  `Idempotency-Key` UUID, and the expected logo version.
- `GET /api/v1/staff/venues/:id/logo`: `{logo,logoVersion,canEditLogo}`.
- `PUT` same path: multipart fields `file` and decimal `version` only.
- `DELETE` same path: JSON `{version}`.
- Reuse the key and payload for retries. A committed replay returns the **current**
  logo without overwriting newer work. Changed payload with the same key is 409;
  stale revision is `logo_version_conflict`, requiring refresh and review.

Creation remains the existing idempotent JSON operation. The binary is never
included in provisioning or its fingerprint. Upload follows the returned venue
ID. A failed logo does not roll back the establishment or its initial service.
The browser keeps the retry file only in memory; after reload, select it again
from the establishment dashboard.

## Image policy and limits

One PNG/JPG/SVG file, at most 5 MiB, with a 64 KiB multipart allowance only on the
PUT logo route. Other staff routes remain limited to 64 KiB. Content is parsed;
filename and MIME alone never establish image validity. PNG/JPG inputs are limited
to 8,000,000 pixels and 16,384 pixels on either side. The server normalizes them
to a maximum 512 px side, preserving aspect ratio, transparency and EXIF orientation
without upscaling. It strips metadata and stores freshly encoded pixels (PNG8 or
JPEG quality 90), not the uploaded original. Area filtering uses premultiplied
alpha to avoid dark fringes on transparent edges.

Safety is not based on compressed file size alone. PNG checks exact expected
scanline inflation in a bounded stream, then CRCs and pixel decoding. Sample
storage is capped at 32 MiB; a conservative estimate (three sample buffers, request
copies and 8 MiB overhead) must fit 96 MiB. The decoder rejects animated PNG, packed
sub-8-bit Adam7 and compressed text metadata. ICC profiles are capped at 1 MiB;
singleton metadata cannot repeat and PNGs have at most 4096 chunks. JPEG decoding
has a 48 MiB allocation budget. Raster decoding is limited to one active operation
per isolate; concurrent attempts get a retryable 503 instead of accumulating
large buffers. Existing images are unchanged on any failure.

The UI distinguishes resolution (`logo_dimensions_exceeded`), decoding memory
(`logo_image_memory_limit`), excessive PNG chunks (`logo_image_complexity_limit`),
unsupported PNG features (`logo_image_unsupported`), busy processing
(`logo_processing_busy`), file bytes (`logo_too_large`) and corrupt/mismatched
content (`invalid_logo`). Some high-bit-depth/complex images below 8 MP still exceed
the memory budget; this is reported explicitly rather than as an invalid format.

SVG is converted in the Worker to a transparent PNG with the longer side 512 px
and preserved aspect ratio, using the locally packaged resvg WASM module. The
original SVG is never stored or served. No images/fonts/network resources are
resolved. SVG must be standalone, UTF-8, well-formed SVG XML; DTDs, scripts,
foreignObject, embedded images, filter/animation elements and external hrefs are
rejected instead of silently losing artwork. Text must be exported as paths
(or supplied as PNG/JPG); the UI explains this error. Parsing has depth/node/attribute
limits, and every WASM instance/image is freed after processing. Complex SVGs
that cannot be rendered receive an explicit error; existing logos remain intact.

## R2/CDN activation checklist (do not execute without deployment approval)

1. Create the environment's dedicated public-logos bucket in the approved account:
   - sandbox: `noqueue-venue-logos-sandbox` / `assets-sandbox.noqueue-app.com`
   - staging: `noqueue-venue-logos-staging` / `assets-staging.noqueue-app.com`
   Bind as `VENUE_LOGOS`, matching `wrangler.jsonc`. Do not mix private files in it.
2. Attach that custom domain to R2 and disable the public `r2.dev` endpoint. No
   public write permission or upload CORS is needed: authenticated uploads use
   the Worker binding, never browser S3 credentials.
3. On that asset hostname, configure a response-header Transform Rule to **set**
   `X-Content-Type-Options: nosniff` and
   `Content-Security-Policy: default-src 'none'; sandbox`.
   R2 HTTP object metadata supports MIME/cache headers, not arbitrary security
   headers; these rules are a required release gate for direct CDN delivery.
   Keep application auth cookies host-only, with no parent-domain cookies.
4. Apply migration 0025 before deploying the API/frontend together. The config
   variable `VENUE_LOGOS_PUBLIC_BASE_URL` must match the custom-domain origin.
   URLs are generated from that trusted configuration, never supplied by clients.
5. Smoke-test a PNG upload, an SVG conversion, replacement, deletion, denied role,
   partial-create retry, and actual CDN MIME/nosniff/CSP/cache headers. No original
   SVG should be present in R2. Confirm an upload failure preserves the old image.

Objects use a new random key for each attempt and immutable one-year Cache-Control.
The source metadata response remains no-store. Removing/replacing a logo changes
the reference immediately, but cannot revoke copies already held in a browser/CDN
cache; these logos are public assets, not confidential files.

## Cleanup and failures

A durable D1 object record is inserted **before** R2 PUT. A successful mutation
updates the venue, audit and idempotency record in one D1 batch. Uploads cannot
commit an expired/claimed object, and keys are never reused. Failed uploads and
unreferenced attempts become collectible after 24 hours. Replaced objects become
eligible within one hour. The existing scheduled Worker claims at most 25 due,
unreferenced objects per run, then deletes R2 and its tracking row; failures retain
the claim and are retried. Attempts rotate oldest-first so unfinished tombstones
cannot starve other pending cleanup work. Unfinished PUT intents retain a tombstone so a late
write cannot recreate an untracked object; monitor and investigate old unfinished
intents after Worker crashes. A live `venue.logo_key` is never collected.

Monitor `venue_logo_cleanup_failed` and `staff_request_failed`, pending object
count/age, and 413/409 rates. No filename, binary payload, credentials or raw SVG
should be logged. Cleanup failure must not block queue maintenance.

## Local verification

`apps/api/test/wrangler.json` uses an isolated local R2 binding, with no remote
bindings. Local public images are served from `/api/v1/venue-logos/:venue/:object`
with the same MIME/cache/security headers; this route is disabled outside APP_ENV
local. Wrangler's default local R2 storage is used for manual development.

Run contracts, API and web tests, type checks, frontend build, and
`wrangler deploy --dry-run --env ''` (never a real deploy as part of verification).
The dry run must bundle resvg's `.wasm` asset, not a remote CDN import. Run the
logo E2E spec on desktop and mobile viewports in Chromium and WebKit.
