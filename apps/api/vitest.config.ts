import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          D360DIALOG_API_KEY: 'test-only-key',
          D360DIALOG_WEBHOOK_TOKEN: 'test-webhook-token-at-least-32-characters',
          PII_ENCRYPTION_KEY: '11'.repeat(32),
          PHONE_HASH_KEY: '22'.repeat(32),
          RECOVERY_TOKEN_KEY: '33'.repeat(32),
          PILOT_ACCESS_TOKEN: 'test-pilot-access-at-least-32-characters',
          WHATSAPP_RECIPIENT_ALLOWLIST: '+34600000000',
          WHATSAPP_ENABLED: 'true',
          CONFIRMATION_EXPERIMENT_ENABLED: 'true',
          PUBLIC_APP_ORIGIN: 'http://localhost:5173',
        },
        queueConsumers: {},
      },
    }),
  ],
  test: { setupFiles: ['./test/setup.ts'] },
})
