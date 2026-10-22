import type {
  ReplacementCommand,
  ReplacementDecision,
} from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { audit, type queueAccess } from '../../auth/access'
import { configuredIntervalMinutes } from './adaptive-model'
import { prepareCall, readCallReplacement, replacementEnabled } from './call'
import { decryptDisplayName } from './crypto'
import {
  commitQueueTransition,
  loadQueueState,
  type QueueState,
} from './projection'
import { publishNotice } from './notices'

type DecisionRow = {
  id: string
  version: number
  entry_id: string
  call_cycle: number
  original_party_size: number
  space_id: string | null
  seats: number | null
  service_ends_at: number | null
  reason: ReplacementDecision['reason']
  created_at: number
}
type Candidate = {
  id: string
  version: number
  code: string
  partySize: number
  preferredSpaceId: string | null
  sequence: number
  displayNameCipher: string | null
  callCycle: number
}
async function decisions(
  env: CloudflareBindings,
  queueId: string,
  now: number,
) {
  return (
    await env.DB.prepare(
      `SELECT d.* FROM queue_replacement_decision d
    JOIN queue_entry e ON e.id=d.entry_id AND e.call_cycle=d.call_cycle AND e.status='expired'
    WHERE d.queue_id=? AND d.status='pending' AND (d.service_ends_at IS NULL OR d.service_ends_at>?)
    ORDER BY d.created_at,d.id`,
    )
      .bind(queueId, now)
      .all<DecisionRow>()
  ).results
}
function seatingFor(
  row: DecisionRow,
  state: QueueState,
): ReplacementDecision['seating'] {
  if (state.config?.type !== 'restaurant' || row.reason !== 'no_candidate')
    return null
  const space = state.config.spaces.find(
    (s) =>
      s.id === row.space_id && s.tableTypes?.some((t) => t.seats === row.seats),
  )
  return space && row.seats !== null
    ? { spaceId: row.space_id!, spaceName: space.name, seats: row.seats }
    : null
}
async function candidatesFor(
  env: CloudflareBindings,
  queueId: string,
  row: DecisionRow,
  now: number,
) {
  // Same-size groups joining later can be chosen manually; never restart the chain automatically.
  const rows = (
    await env.DB.prepare(
      `SELECT id,version,code,party_size AS partySize,
    preferred_space_id AS preferredSpaceId,sequence,display_name_cipher AS displayNameCipher,call_cycle AS callCycle
    FROM queue_entry WHERE queue_id=? AND status='waiting' AND party_size<=?
    AND (preferred_space_id IS NULL OR preferred_space_id='fastest' OR preferred_space_id=?)
    AND (service_ends_at IS NULL OR service_ends_at>?) ORDER BY CASE WHEN party_size<=? THEN 0 ELSE 1 END,party_size DESC,sequence,id`,
    )
      .bind(queueId, row.seats!, row.space_id, now, row.original_party_size)
      .all<Candidate>()
  ).results
  return rows
}
export async function readReplacementDecisions(
  env: CloudflareBindings,
  queueId: string,
  now = Date.now(),
): Promise<ReplacementDecision[]> {
  const state = await loadQueueState(env, queueId, now)
  const rows = await decisions(env, queueId, now)
  return Promise.all(
    rows.map(async (row) => {
      const seating = seatingFor(row, state)
      const unavailable = !replacementEnabled(env)
        ? 'disabled'
        : !seating
        ? 'context'
        : null
      const candidates = unavailable
        ? []
        : await candidatesFor(env, queueId, row, now)
      return {
        id: row.id,
        version: row.version,
        entryId: row.entry_id,
        originalPartySize: row.original_party_size,
        createdAt: row.created_at,
        reason: row.reason,
        unavailable,
        seating,
        candidates: await Promise.all(
          candidates.map(async (p) => ({
            id: p.id,
            version: p.version,
            code: p.code,
            partySize: p.partySize,
            displayName: p.displayNameCipher
              ? await decryptDisplayName(
                  env.PII_ENCRYPTION_KEY,
                  p.displayNameCipher,
                )
              : null,
          })),
        ),
      }
    }),
  )
}
/** Called only inside QueueCoordinator, after maintenance and the common idempotency lookup. */
export async function resolveReplacementDecision(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  key: string,
  fingerprint: string,
  command: ReplacementCommand,
  state: QueueState,
  access: Awaited<ReturnType<typeof queueAccess>>,
  now: number,
) {
  const row = (await decisions(env, queueId, now)).find(
    (r) => r.id === command.decisionId,
  )
  if (!row || row.version !== command.decisionVersion)
    throw new HTTPException(409, { message: 'replacement_changed' })
  const statements: D1PreparedStatement[] = []
  let successor: Candidate | undefined
  let call: Awaited<ReturnType<typeof prepareCall>> | undefined
  if (command.action === 'resolve_replacement') {
    const seating = seatingFor(row, state)
    const policy = await readCallReplacement(env, row.entry_id, row.call_cycle)
    if (!replacementEnabled(env) || !policy?.eligible || !seating)
      throw new HTTPException(409, { message: 'replacement_unavailable' })
    successor = (await candidatesFor(env, queueId, row, now)).find(
      (p) => p.id === command.entryId && p.version === command.version,
    )
    if (!successor)
      throw new HTTPException(409, { message: 'replacement_changed' })
    call = await prepareCall(env, queueId, state, successor, {
      now,
      callCycle: successor.callCycle + 1,
      origin: 'staff',
      source: 'handoff',
      inherited: policy,
      context: {
        spaceId: seating.spaceId,
        seats: seating.seats,
        provenance: 'confirmed',
        baselineMinutes: configuredIntervalMinutes(
          state.config!,
          state.baseline,
          seating.spaceId,
          seating.seats,
        ),
      },
    })
    statements.push(
      ...call.statements,
      env.DB.prepare(
        `UPDATE queue_entry SET status='called',version=version+1,call_cycle=call_cycle+1,
        called_at=?,arrival_deadline_at=?,progress_initial_eta_minutes=COALESCE(progress_initial_eta_minutes,?)
        WHERE id=? AND queue_id=? AND status='waiting' AND version=?`,
      ).bind(
        now,
        call.deadline,
        call.graceMinutes,
        successor.id,
        queueId,
        successor.version,
      ),
      env.DB.prepare(
        "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'called',?)",
      ).bind(crypto.randomUUID(), successor.id, now),
      env.DB.prepare(
        `UPDATE queue_call_replacement SET successor_entry_id=?,successor_call_cycle=?,updated_at=?
        WHERE entry_id=? AND call_cycle=?`,
      ).bind(
        successor.id,
        successor.callCycle + 1,
        now,
        row.entry_id,
        row.call_cycle,
      ),
    )
  }
  statements.push(
    env.DB.prepare(
      `UPDATE queue_replacement_decision SET status=?,version=version+1,resolved_by=?,
      successor_entry_id=?,updated_at=? WHERE id=? AND status='pending' AND version=?`,
    ).bind(
      successor ? 'assigned' : 'dismissed',
      actor,
      successor?.id ?? null,
      now,
      row.id,
      row.version,
    ),
    audit(
      env,
      actor,
      access.organizationId,
      access.venueId,
      `queue.${command.action}`,
      row.id,
    ),
    env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)').bind(
      actor,
      key,
      fingerprint,
      JSON.stringify({ ok: true }),
    ),
  )
  await commitQueueTransition(
    env,
    queueId,
    state,
    successor && call
      ? {
          config: state.config,
          parties: state.parties.filter((p) => p.id !== successor.id),
          assignment: call.assignment,
        }
      : {},
    statements,
    now,
    `staff.${command.action}`,
  )
  if (successor) await publishNotice(env, successor.id, 'ready')
  return { ok: true }
}
