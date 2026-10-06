import { env } from 'cloudflare:workers'
import { issueLocationToken } from '../src/features/staff/location'
export async function fixtureLocation(actor: string) {
  const locationOperationId = crypto.randomUUID()
  const candidate = await issueLocationToken(
    env,
    actor,
    { kind: 'provision', id: locationOperationId },
    {
      formatted: 'Calle Mayor 1, Madrid',
      latitude: 40.416,
      longitude: -3.704,
      address: { street: 'Calle Mayor', city: 'Madrid', countryCode: 'es' },
      provider: 'geoapify',
      providerId: 'fixture',
      attribution: [{ text: 'Geoapify', url: 'https://www.geoapify.com/' }],
    },
  )
  return { locationOperationId, locationToken: candidate.token }
}
