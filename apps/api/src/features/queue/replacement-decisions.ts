import type { ReplacementDecision } from '@noqueue/contracts/staff'

/** Compatibility read only. Historical rows remain available for audit/backup. */
export async function readReplacementDecisions(
  _env: CloudflareBindings,
  _queueId: string,
  _now = Date.now(),
): Promise<ReplacementDecision[]> {
  return []
}
