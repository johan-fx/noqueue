# Test contracts at their observable boundaries

## Test layers

- Contract tests prove Zod accepts the documented wire payload.
- API tests call the Hono app and validate the response with the public schema.
- React tests verify the selected experience renders.
- Playwright verifies the Worker serves both the API and static React application in Chromium, Firefox and WebKit.

## Commands

```bash
pnpm test
pnpm test:e2e
```

Do not mock internal modules by default. Mock only external provider boundaries such as WhatsApp, APNs/FCM or payment systems when those integrations are introduced.
