import { healthResponseSchema, type HealthResponse } from '@noqueue/contracts/health'

export async function fetchHealth(
  apiUrl = import.meta.env.VITE_API_URL ?? '',
): Promise<HealthResponse> {
  const response = await fetch(`${apiUrl}/api/v1/health`)

  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`)
  }

  return healthResponseSchema.parse(await response.json())
}
