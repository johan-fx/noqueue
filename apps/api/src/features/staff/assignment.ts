import type { loadQueueState } from '../queue/projection'
import { hash } from '../queue/crypto'

/** The token protects the waiting entry and its version, never an inventory photograph. */
export async function assignmentContext(
  state: Awaited<ReturnType<typeof loadQueueState>>,
  entryId: string,
  _now: number,
) {
  const party = state.parties.find((p) => p.id === entryId)
  return {
    available: !!party,
    spaceName: null,
    priorityRequired: false,
    token: await hash(
      JSON.stringify({ party, status: party ? 'waiting' : null }),
    ),
  }
}
