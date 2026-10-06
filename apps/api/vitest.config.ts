import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          GEOAPIFY_API_KEY: 'test-only-geocode-key',
          BETTER_AUTH_SECRET: 'test-only-better-auth-secret-at-least-32-bytes',
          AUTH_EMAIL_API_KEY: 'test-mail-key',
          AUTH_EMAIL_FROM: 'NoQueue <test@example.com>',
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
  test: {
    setupFiles: ['./test/setup.ts'],
    env: {
      QUEUE_PROPERTY_RUNS: process.env.QUEUE_PROPERTY_RUNS ?? '200',
      QUEUE_SEQUENCE_RUNS: process.env.QUEUE_SEQUENCE_RUNS ?? '20',
      QUEUE_SEQUENCE_LENGTH: process.env.QUEUE_SEQUENCE_LENGTH ?? '25',
      QUEUE_SEED: process.env.QUEUE_SEED ?? '20260929',
      QUEUE_PATH: process.env.QUEUE_PATH ?? '',
    },
  },
})
