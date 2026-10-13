// Local deterministic simulation. No network, credentials, database or messages.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  learnContextualFactors,
  resolveEstimateContext,
  forecastInterval,
} from '../../apps/api/src/features/queue/adaptive-model.ts'
const config = {
  type: 'restaurant',
  averageMinutes: 8,
  spaces: [
    {
      id: 'inside',
      name: 'Interior',
      tables: 10,
      tableTypes: [
        { seats: 2, count: 5, averageMinutes: 8 },
        { seats: 4, count: 5, averageMinutes: 20 },
      ],
    },
    {
      id: 'outside',
      name: 'Terraza',
      tables: 2,
      tableTypes: [
        { seats: 2, count: 1, averageMinutes: 8 },
        { seats: 4, count: 1, averageMinutes: 20 },
      ],
    },
  ],
}
const contexts = [
  { partySize: 2, preferredSpaceId: 'inside' },
  { partySize: 4, preferredSpaceId: 'inside' },
  { partySize: 2, preferredSpaceId: 'outside' },
  { partySize: 4, preferredSpaceId: 'outside' },
  { partySize: 2, preferredSpaceId: null },
  { partySize: 8, preferredSpaceId: 'inside' },
]
// Alternating human assignments under continuous demand. Each interval belongs
// to the newly assigned party, NOT the gap between assignments in its category.
const evidence = []
const serviceRatios = []
const result = []
for (let cycle = 0; cycle <= 10; cycle++) {
  const factors = learnContextualFactors(config, serviceRatios, evidence)
  result.push({
    samples: evidence.length,
    serviceFactor: factors.service,
    forecasts: contexts.map((party) => ({
      ...party,
      context: resolveEstimateContext(party, config, 8),
      minutes: forecastInterval(party, config, 8, factors).cadenceMs / 60000,
      quality: forecastInterval(party, config, 8, factors).quality,
    })),
  })
  for (const [i, party] of contexts.slice(0, 4).entries()) {
    const context = resolveEstimateContext(party, config, 8)
    const intervalMinutes = [4, 15, 10, 24][i]
    const ratio = intervalMinutes / context.baselineMinutes
    evidence.push({ space_id: context.spaceId, seats: context.seats, ratio })
    serviceRatios.push(ratio)
  }
}
const report = {
  scenario: 'Synthetic continuous demand; no demonstrated real-world accuracy',
  initial: result[0],
  learned: result.at(-1),
  checkpoints: result,
}
const output = fileURLToPath(
  new URL('../../reports/queue-contextual/simulation.json', import.meta.url),
)
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.table(
  report.initial.forecasts.map((p, i) => ({
    zone: p.preferredSpaceId ?? 'sin preferencia',
    size: p.partySize,
    initial: p.minutes,
    learned: Number(report.learned.forecasts[i].minutes.toFixed(3)),
    quality: report.learned.forecasts[i].quality,
  })),
)
console.log(output)
