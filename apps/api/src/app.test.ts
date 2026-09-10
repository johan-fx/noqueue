import { healthResponseSchema } from '@noqueue/contracts/health'
import { describe, expect, it } from 'vitest'
import { app } from './app'

describe('GET /api/v1/health', () => {
  it('returns the versioned public health contract', async () => {
    const response = await app.request('/api/v1/health')

    expect(response.status).toBe(200)
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: 'ok',
      service: 'noqueue-api',
    })
  })
})
