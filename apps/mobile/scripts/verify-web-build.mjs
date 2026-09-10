import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

const webEntry = fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))

try {
  await access(webEntry, constants.R_OK)
} catch {
  throw new Error(
    `Missing ${webEntry}. Run \"pnpm --filter @noqueue/web build\" before syncing Capacitor.`,
  )
}
