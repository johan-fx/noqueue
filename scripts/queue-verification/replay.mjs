const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

export function replayMetadata(id, environment = process.env, errors = []) {
  if (!['Q-SEQUENCES', 'Q-PROPERTY'].includes(id)) return undefined
  const diagnostic = errors.join('\n')
  const seed = Number(
    diagnostic.match(/seed:\s*(-?\d+)/)?.[1] ??
      environment.QUEUE_SEED ??
      20260929,
  )
  const path =
    diagnostic.match(/path:\s*"([^"]*)"/)?.[1] ??
    environment.QUEUE_PATH ??
    null
  const propertyRuns = Number(environment.QUEUE_PROPERTY_RUNS ?? 200)
  const sequenceRuns = Number(environment.QUEUE_SEQUENCE_RUNS ?? 20)
  const sequenceLength = Number(environment.QUEUE_SEQUENCE_LENGTH ?? 25)
  const profile =
    propertyRuns === 2000 && sequenceRuns === 100 && sequenceLength === 100
      ? 'extended'
      : propertyRuns === 200 && sequenceRuns === 20 && sequenceLength === 25
      ? 'standard'
      : 'custom'
  const file =
    id === 'Q-SEQUENCES'
      ? 'verification.test.ts'
      : 'verification-engine.test.ts'
  const command = [
    `QUEUE_PROPERTY_RUNS=${propertyRuns}`,
    `QUEUE_SEQUENCE_RUNS=${sequenceRuns}`,
    `QUEUE_SEQUENCE_LENGTH=${sequenceLength}`,
    `QUEUE_SEED=${seed}`,
    ...(path === null ? [] : [`QUEUE_PATH=${quote(path)}`]),
    'pnpm --filter @noqueue/api exec vitest run',
    `src/features/queue/${file} -t ${id}`,
  ].join(' ')
  return {
    profile,
    propertyRuns,
    sequenceRuns,
    sequenceLength,
    seed,
    path,
    command,
  }
}
