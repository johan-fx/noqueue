import { describe, expect, it } from 'vitest'
import { parseQueueNoticeSnapshot } from './notices'

describe('parseQueueNoticeSnapshot', () => {
  it('validates and preserves adaptive metadata and forward-compatible fields', () => {
    const raw = {
      schemaVersion: 2,
      copyVersion: 4,
      copyVariant: 'delayed',
      serviceName: 'Dinner',
      ahead: 2,
      etaMinutes: 7,
      predictedAt: 10_000,
      estimateQuality: 'provisional',
      resourceName: null,
      arrivalDeadlineAt: null,
      estimatorVersion: 2,
      estimationRevision: 11,
      correctionReason: 'safety',
      safetyRevision: 3,
      approachEpisode: 4,
      retainedByV4: 'metadata',
    }

    expect(parseQueueNoticeSnapshot(raw)).toEqual(raw)
  })

  it('rejects malformed adaptive revisions instead of accepting a partial snapshot', () => {
    expect(
      parseQueueNoticeSnapshot({
        schemaVersion: 2,
        serviceName: 'Dinner',
        ahead: 2,
        etaMinutes: 7,
        predictedAt: 10_000,
        estimateQuality: 'provisional',
        resourceName: null,
        arrivalDeadlineAt: null,
        estimatorVersion: 2,
        estimationRevision: -1,
      }),
    ).toBeNull()
  })
})
