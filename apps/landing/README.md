# NoQueue public landing

Independent, bilingual Spanish/English informational site at the `https://noqueue-app.com/` public root. NoQueue is in development; this site does not offer access to the pilot or a working queue service.

## Local workflow

From the repository root:

```sh
pnpm --filter @noqueue/landing build
pnpm --filter @noqueue/landing check
pnpm --filter @noqueue/landing check:deploy
pnpm --filter @noqueue/landing dev
```

The preview binds only to `http://127.0.0.1:8788` (inspector port 9231). Rebuild after editing `src/`; Wrangler watches the resulting assets. `check:deploy` packages locally with `--dry-run`; it does not publish anything or validate DNS/account ownership.

With the preview running, `node apps/landing/scripts/browser-check.mjs` uses the existing repository Playwright installation for 15 browser scenarios. Set `LANDING_SCREENSHOTS` to an output directory to save English dark-mode desktop/mobile screenshots. No browser dependencies are added to the landing.

## Boundaries

- `src/` contains the complete public HTML/CSS/assets. The build copies only this directory to ignored `dist/`.
- Only a small local preferences script is shipped. No form, analytics, external fonts, API requests, databases, service bindings, or pilot links are shipped.
- `wrangler.jsonc` describes a separate `noqueue-landing` static-assets deployment, scoped only to the apex domain. Unknown paths receive the custom 404, not an app fallback. Workers.dev and preview URLs are disabled.
- There is no Worker script, so Worker execution logs/traces are not applicable. Hosting-layer logging is controlled by the hosting account.
- The public contact email is `hola@noqueue-app.com`. Keep public copy and its content test aligned when updating it.

## Language and appearance

Spanish content and owner details remain readable without JavaScript. The native language select and accessible dark-mode switch use shadcn-like styling without adding React or shadcn. English translations live next to their Spanish source in authored `data-en` attributes. Preferences are stored locally under `noqueue.language` and `noqueue.theme`; blocked storage does not disable the controls. The initial language is Spanish, and the initial theme follows the operating system unless explicitly saved.

## Production deployment

Published with user authorization on 2026-09-12 using Wrangler 4.131.0.

- Worker: `noqueue-landing`; account: `fa5fab4df1b0f12c946a3ea47fab96eb`.
- Version: `083d0382-1b42-40b2-b94b-c7586a76e2ed` at 100%; custom domain: `noqueue-app.com` only.
- Readback confirmed no bindings and disabled workers.dev/preview URLs. HTTPS returned 200, matching the built HTML and final company email; API/demo/missing paths returned 404. All 15 browser scenarios passed against production.
- Recheck with `LANDING_URL=https://noqueue-app.com node apps/landing/scripts/browser-check.mjs`.
- Use an interactive TTY for future Wrangler custom-domain deployment: version 4.131.0 silently enables DNS/origin overwrite in non-TTY mode. Stop rather than approve an unexpected conflict.

## Before another publication

Publication is a separate, explicitly authorized operation. Confirm the owner/contact details and development-status wording, review the target Cloudflare account and existing apex DNS/route assignments, and confirm that the informational page meets the intended business verification requirements. This page does not guarantee Meta approval or establish legal compliance. Do not publish the API/web bundle in place of this landing.

Rollback for this uncommitted unit: remove `apps/landing/` and only the `apps/landing` importer from the lockfile. Preserve all pre-existing API/web/lockfile edits. This does not undo the production deployment. Remote rollback/unpublication is a separate authorized operation, scoped to this Worker and its apex custom domain; preserve unrelated services and all email DNS records.

References: [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/get-started/), [custom 404 routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/). Configuration was checked against the installed Wrangler 4.131.0 schema.
