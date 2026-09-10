# Keep local, staging and production configuration distinct

Only local configuration exists in the bootstrap. Staging and production remain blocked until Cloudflare account ownership, jurisdiction, resource names and secret-management responsibilities are approved.

| Configuration | Visibility | Storage |
| --- | --- | --- |
| `VITE_API_URL` | Public, bundled into client code | `.env` locally; build environment remotely |
| Worker non-secret vars | Server-side | Wrangler environment configuration |
| Provider credentials | Secret | `.dev.vars` locally; Cloudflare secrets remotely |
| D1/DO identifiers | Infrastructure metadata | Environment-specific Wrangler configuration |

Never place secrets in `VITE_*`, Git, documentation, native resource files or checked-in Wrangler vars.
