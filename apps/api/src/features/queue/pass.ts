import { compatibleSuccessor, type EstimateContext } from './adaptive-model'
import { compareEffectiveQueueOrder, type Party } from './engine'
import type { ServiceInput } from '@noqueue/contracts/staff'

/** Queue-entry details needed to prepare a pass without performing I/O. */
export type PassParty = Party & { version: number; callCycle?: number }

export type SequenceExchange = {
  /** The old called/waiting entry takes the successor's FIFO slot. */
  currentSequence: number
  /** The successor takes the old entry's FIFO slot. */
  successorSequence: number
}

/**
 * Resolve the next compatible party after a waiting entry in effective queue
 * order (one-use priority first, then FIFO). A pass is not an assignment.
 */
export function nextPassSuccessor(
  current: Party,
  parties: readonly Party[],
  context: EstimateContext,
  serviceType: ServiceInput['type'] | null,
) {
  const compatible = (candidate: Party) => {
    if (!serviceType) return false
    if (serviceType === 'restaurant')
      return compatibleSuccessor(current, candidate, context)
    if (serviceType === 'reception')
      return current.receptionService != null &&
        candidate.receptionService === current.receptionService
    // Bar / pool turns are not constrained by the party size being passed.
    return true
  }
  const ordered = [...parties].sort(compareEffectiveQueueOrder)
  const currentIndex = ordered.findIndex((party) => party.id === current.id)
  if (currentIndex < 0) return undefined
  return ordered
    .slice(currentIndex + 1)
    .find(compatible)
}

/**
 * Calculate a collision-free exchange. Callers first move `current` to
 * MAX(sequence)+1, then apply these two final values in the same DB batch.
 * Using min/max also preserves FIFO when a called cycle hands off to someone
 * who was already ahead of the called entry.
 */
export function exchangePassSequences(
  current: Pick<Party, 'sequence'>,
  successor: Pick<Party, 'sequence'>,
): SequenceExchange {
  return {
    currentSequence: Math.max(current.sequence, successor.sequence),
    successorSequence: Math.min(current.sequence, successor.sequence),
  }
}

/** Pure projected waiting list for a waiting-entry swap. */
export function prepareWaitingPassParties(
  parties: readonly Party[],
  current: Party,
  successor: Party,
): Party[] {
  const sequences = exchangePassSequences(current, successor)
  return [
    ...parties
      .filter((party) => party.id !== successor.id && party.id !== current.id)
      .map((party) => ({ ...party })),
    {
      ...successor,
      sequence: sequences.successorSequence,
    },
    {
      ...current,
      sequence: sequences.currentSequence,
      priorityRank: null,
    },
  ]
}

/** Called entries are not in the waiting projection; only their successor is removed. */
export function prepareCalledPassParties(
  parties: readonly Party[],
  current: Party,
  successor: Party,
): Party[] {
  const sequences = exchangePassSequences(current, successor)
  return [
    ...parties
      .filter((party) => party.id !== successor.id && party.id !== current.id)
      .map((party) => ({ ...party })),
    {
      ...current,
      sequence: sequences.currentSequence,
      priorityRank: null,
    },
  ]
}

/** Returning a called entry without a successor keeps its exact FIFO slot. */
export function prepareReturnedPassParties(
  parties: readonly Party[],
  current: Party,
): Party[] {
  return [
    ...parties.filter((party) => party.id !== current.id).map((party) => ({ ...party })),
    { ...current, priorityRank: null },
  ]
}
