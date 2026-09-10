# Run the web and API on one Cloudflare Worker

The Worker handles `/api/*` first and serves the Vite build through Workers Static Assets for every other route. This keeps browser API calls same-origin while Capacitor uses a configured absolute API origin.

## Bindings

| Binding | Purpose | Bootstrap state |
| --- | --- | --- |
| `DB` | D1 system of record | Local placeholder only |
| `QUEUE_COORDINATOR` | One Durable Object coordination boundary per queue | Class registered; behavior intentionally unimplemented |
| `ASSETS` | Vite production bundle | Points to `apps/web/dist` |

`wrangler.jsonc` contains no real account resource identifiers. Provisioning and deployment require an explicit environment decision and are documented separately.

After any binding change, regenerate TypeScript definitions:

```bash
pnpm --filter @noqueue/api cf-typegen
```
