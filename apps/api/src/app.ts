import { healthResponseSchema } from '@noqueue/contracts/health'
import { Hono } from 'hono'

export const app = new Hono<{ Bindings: CloudflareBindings }>().basePath('/api/v1')

app.get('/health', (context) => {
  const response = healthResponseSchema.parse({
    status: 'ok',
    service: 'noqueue-api',
  })

  return context.json(response)
})

export type AppType = typeof app
