# Reproduce the scaffold with official generators

The repository is already bootstrapped. This record explains where the generated foundations came from; do not rerun these commands over an existing workspace.

| Foundation | Official command used |
| --- | --- |
| React/Vite | `pnpm create vite@latest apps/web --template react-ts --no-interactive --no-immediate --eslint` |
| Hono Worker | `pnpm create hono@latest apps/api --template cloudflare-workers --pm pnpm` |
| shadcn/Base UI | `pnpm dlx shadcn@latest init --cwd apps/web --template vite --base base --defaults --no-monorepo --yes` |
| Capacitor | `pnpm exec cap init "No Queue" "com.noqueue.app" --web-dir ../web/dist` |
| Native platforms | `pnpm exec cap add android` and `pnpm exec cap add ios --packagemanager SPM` |
| Playwright | `pnpm create playwright tests/e2e --browser chromium firefox webkit --no-examples` |

Generators were run without nested dependency installations where supported, then normalized to the root pnpm workspace. Generated nested workspace files, sample screens and sample native tests were removed. `packages/contracts` is deliberately a minimal hand-authored package because running a repository-level starter over the existing PRD would be destructive.

After dependency or binding changes, use the checked-in root scripts rather than rerunning a generator.
