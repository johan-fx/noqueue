import { record } from './queue-evidence'
import { it } from 'vitest'
import { env } from 'cloudflare:workers'
import { app } from '../src/app'
it('Q-PRODUCTION local history controls do not exist in the production app', async () => {
  const response = await app.request(
    'http://localhost/api/v1/experiments/local/staff/queue-history',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NoQueue-Pilot-Token': env.PILOT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        queueId: crypto.randomUUID(),
        spaceId: 'terrace',
        seats: 4,
        durations: [60, 60, 60],
      }),
    },
    env,
  )
  record(
    'Q-PRODUCTION',
    'production HTTP route is absent',
    0,
    response.status,
    404,
  )
})
