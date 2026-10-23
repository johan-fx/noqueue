import type {
  QueueCommandResult,
  QueueFeedbackEntry,
} from '@noqueue/contracts/staff'
import { decryptDisplayName } from './crypto'

/** Persist command facts and entry references, never decrypted personal names. */
export function serializeStaffCommandResult(result: QueueCommandResult): string {
  const outcome = result.outcome
  if (!outcome) return JSON.stringify(result)
  return JSON.stringify({
    ...result,
    outcome: {
      ...outcome,
      entry: { ...outcome.entry, displayName: null },
      ...(outcome.successor === undefined
        ? {}
        : {
            successor: outcome.successor
              ? { ...outcome.successor, displayName: null }
              : null,
          }),
    },
  })
}

/** Rehydrate current names only after the caller's queue authorization check. */
export async function hydrateStaffCommandResult(
  env: CloudflareBindings,
  queueId: string,
  serialized: string,
): Promise<QueueCommandResult> {
  const result = JSON.parse(serialized) as QueueCommandResult
  const outcome = result.outcome
  if (!outcome) return result

  const hydrateEntry = async (
    entry: QueueFeedbackEntry,
  ): Promise<QueueFeedbackEntry> => {
    const row = await env.DB.prepare(
      'SELECT display_name_cipher AS displayNameCipher FROM queue_entry WHERE id=? AND queue_id=?',
    )
      .bind(entry.id, queueId)
      .first<{ displayNameCipher: string | null }>()
    return {
      ...entry,
      // Keep the original safe code/reference if the queue entry was deleted.
      displayName: row?.displayNameCipher
        ? await decryptDisplayName(env.PII_ENCRYPTION_KEY, row.displayNameCipher)
        : null,
    }
  }

  const entry = await hydrateEntry(outcome.entry)
  const successor =
    outcome.successor === undefined || outcome.successor === null
      ? outcome.successor
      : await hydrateEntry(outcome.successor)
  return {
    ...result,
    outcome: {
      ...outcome,
      entry,
      ...(outcome.successor === undefined ? {} : { successor }),
    },
  }
}
