# Keep local, staging and production configuration distinct

Local, sandbox, staging and isolated production configurations exist. Production was provisioned and published on 2026-10-17 with GA and WhatsApp OFF; see [the release record](production-release-2026-10-17.md). Only Geoapify is intentionally shared with staging by explicit user authorization. All production security secrets and data are independent. Follow [the production launch runbook](../runbooks/production-launch.md); never deploy the top-level local configuration.

| Configuration | Visibility | Storage |
| --- | --- | --- |
| `VITE_API_URL` | Public, bundled into client code | `.env` locally; build environment remotely |
| Worker non-secret vars | Server-side | Wrangler environment configuration |
| Provider credentials | Secret | `.dev.vars` locally; Cloudflare secrets remotely |
| D1/DO identifiers | Infrastructure metadata | Environment-specific Wrangler configuration |

Never place secrets in `VITE_*`, Git, documentation, native resource files or checked-in Wrangler vars.
