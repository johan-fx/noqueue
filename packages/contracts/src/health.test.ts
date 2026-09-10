import { describe, expect, it } from 'vitest'
import { healthResponseSchema } from './health'

describe('healthResponseSchema', () => {
  it('accepts the public health response', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', service: 'noqueue-api' }),
    ).toEqual({ status: 'ok', service: 'noqueue-api' })
  })
})
