import { eligibleResources } from '../queue/engine'
import type { loadQueueState } from '../queue/projection'
import { hash } from '../queue/crypto'

/** Identical compatibility and priority decisions for projection and command validation. */
export async function assignmentContext(
  state: Awaited<ReturnType<typeof loadQueueState>>,
  entryId: string,
  now: number,
) {
  const party = state.parties.find((p) => p.id === entryId)
  const free = party
    ? eligibleResources(
        party,
        state.resources,
        state.config?.assignmentPreference,
      )
        .filter(
          (r) =>
            r.callable &&
            r.availableAt !== null &&
            r.availableAt <= now &&
            !state.allocations.some(
              (a) => a.resource_id === r.id && a.released_at === null,
            ),
        )
        .sort((a, b) => a.seats - b.seats || a.id.localeCompare(b.id))
    : []
  const resource = state.inventorySafety.requiresSurvey ? undefined : free[0]
  const oldest =
    resource &&
    state.parties.find((p) =>
      eligibleResources(
        p,
        state.resources,
        state.config?.assignmentPreference,
      ).some((r) => r.id === resource.id),
    )
  return {
    resource,
    available: !!resource,
    spaceName:
      state.config?.spaces.find((s) => s.id === resource?.spaceId)?.name ??
      null,
    priorityRequired: !!oldest && oldest.id !== entryId,
    token: await hash(
      JSON.stringify({
        resource: resource?.id,
        oldest: oldest?.id,
        parties: state.parties,
        free: free.map((r) => r.id),
      }),
    ),
  }
}
