# Use root commands for routine development

| Command | Outcome |
| --- | --- |
| `pnpm dev` | Builds the initial web artifact, then starts Vite and Wrangler |
| `pnpm build` | Builds every buildable workspace in dependency order |
| `pnpm check-types` | Runs strict TypeScript checks |
| `pnpm lint` | Runs each workspace's current static checks |
| `pnpm test` | Runs unit and contract tests |
| `pnpm test:e2e` | Starts the production-like local Worker and runs Playwright |
| `pnpm mobile:sync` | Builds web, verifies `dist/index.html`, then runs `cap sync` |

Filter a workspace when diagnosing one subsystem:

```bash
pnpm --filter @noqueue/api dev
pnpm --filter @noqueue/web test
pnpm --filter @noqueue/contracts check-types
```
