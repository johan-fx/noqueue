import {
  selectAutomationSuccessor,
  stopAutomation,
  stopQueueAutomation,
} from '../queue/automation'
import {
  configuredIntervalMinutes,
  resolveEstimateContext,
  type EstimateContext,
} from '../queue/adaptive-model'
import { sameConfiguration, touchVenueConfiguration } from './configuration'
import { assignmentContext } from './assignment'
import { lifecycleNoticeStatements, publishNotice } from '../queue/notices'
import { directoryConfigStatement } from '../discovery/configuration'
import { activateIfReady } from '../queue/opening-state'
import {
  commitQueueTransition,
  maintainQueue,
  type QueueModelInput,
  loadQueueState,
  normalizeConfig,
  recalculateQueue,
} from '../queue/projection'
import {
  queueCommandSchema,
  queueSettingsSchema,
  weeklySchedule,
  type QueueCommand,
  type EntryCommand,
  type ServiceInput,
  allowedEntryActions,
  assignmentTableOptions,
} from '@noqueue/contracts/staff'
import { HTTPException } from 'hono/http-exception'
import { queueAccess, audit } from '../../auth/access'
import { hash } from '../queue/crypto'
import {
  prepareCall,
  finishCallReplacement,
  readCallReplacement,
} from '../queue/call'
import { feedbackEntry } from '../queue/feedback'
import {
  hydrateStaffCommandResult,
  serializeStaffCommandResult,
} from '../queue/command-result'
import {
  exchangePassSequences,
  nextPassSuccessor,
  prepareCalledPassParties,
  prepareReturnedPassParties,
  prepareWaitingPassParties,
} from '../queue/pass'
import type { Party } from '../queue/engine'
import type { QueueCommandResult } from '@noqueue/contracts/staff'

async function entryVersionConflict(
  env: CloudflareBindings,
  queueId: string,
  entry: {
    id: string
    status: string
    call_cycle: number
  },
): Promise<never> {
  if (entry.status === 'expired') {
    const expired = await env.DB.prepare(
      "SELECT 1 FROM queue_staff_event WHERE queue_id=? AND entry_id=? AND call_cycle=? AND cause='arrival_expiry' LIMIT 1",
    )
      .bind(queueId, entry.id, entry.call_cycle)
      .first()
    if (expired)
      throw new HTTPException(409, {
        message: 'turn_automatically_processed',
      })
  }
  if (entry.status === 'called') {
    const assigned = await env.DB.prepare(
      'SELECT 1 FROM queue_staff_event WHERE queue_id=? AND successor_entry_id=? AND successor_call_cycle=? LIMIT 1',
    )
      .bind(queueId, entry.id, entry.call_cycle)
      .first()
    if (assigned)
      throw new HTTPException(409, {
        message: 'turn_automatically_assigned',
      })
  }
  throw new HTTPException(409, { message: 'version_conflict' })
}

export async function runQueueCommand(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  key: string,
  command: QueueCommand,
  now = Date.now(),
): Promise<QueueCommandResult> {
  const access = await queueAccess(env, actor, queueId, 'queue.operate')
  if ((command.action as string) === 'release')
    throw new HTTPException(410, { message: 'operation_retired' })
  queueCommandSchema.parse(command)
  const fingerprint = await hash(JSON.stringify({ queueId, input: command }))
  const previous = await env.DB.prepare(
    'SELECT request_hash,result FROM staff_command WHERE actor_id=? AND request_key=?',
  )
    .bind(actor, key)
    .first<{ request_hash: string; result: string }>()
  if (previous) {
    if (previous.request_hash !== fingerprint)
      throw new HTTPException(409, { message: 'idempotency_conflict' })
    await recalculateQueue(env, queueId, now)
    return hydrateStaffCommandResult(env, queueId, previous.result)
  }
  await maintainQueue(env, queueId, now)
  const state = await loadQueueState(env, queueId, now)
  if (command.action === 'resolve_replacement' || command.action === 'dismiss_replacement')
    throw new HTTPException(410, { message: 'operation_retired' })
  const quick = state.config?.type !== 'restaurant'
  let input: EntryCommand
  if (command.action === 'assign_next') {
    if (!quick) throw new HTTPException(409, { message: 'unsupported_action' })
    if (!command.expectedEntryId || command.expectedVersion === undefined)
      throw new HTTPException(409, { message: 'assignment_precondition_required' })
    const first = await env.DB.prepare(
      "SELECT id,version FROM queue_entry WHERE queue_id=? AND status='waiting' AND manual_only=0 ORDER BY CASE WHEN priority_rank IS NULL THEN 1 ELSE 0 END,priority_rank,sequence,id LIMIT 1",
    )
      .bind(queueId)
      .first<{ id: string; version: number }>()
    if (!first || first.id !== command.expectedEntryId || first.version !== command.expectedVersion)
      throw new HTTPException(409, { message: 'assignment_next_changed' })
    input = { action: 'call', entryId: first.id, version: first.version }
  } else input = command
  const entry = await env.DB.prepare(
    'SELECT status,version,called_at,arrival_deadline_at,service_window_id,service_ends_at,call_cycle,manual_only,priority_rank,sequence,party_size,preferred_space_id FROM queue_entry WHERE id=? AND queue_id=?',
  )
    .bind(input.entryId, queueId)
    .first<{
      status: string
      version: number
      called_at: number | null
      arrival_deadline_at: number | null
      service_window_id: string | null
      service_ends_at: number | null
      call_cycle: number
      manual_only: number
      priority_rank: number | null
      sequence: number
      party_size: number
      preferred_space_id: string | null
    }>()
  if (!entry) throw new HTTPException(404, { message: 'not_found' })
  const callParty = input.action === 'call' ? await env.DB.prepare('SELECT id,sequence,version,party_size AS partySize,preferred_space_id AS preferredSpaceId FROM queue_entry WHERE id=?').bind(input.entryId).first<import('../queue/engine').Party>() : null
  const callState = callParty && !state.parties.some(p => p.id === callParty.id) ? { ...state, parties: [...state.parties, callParty] } : state

  if (entry.version !== input.version)
    await entryVersionConflict(env, queueId, {
      id: input.entryId,
      status: entry.status,
      call_cycle: entry.call_cycle,
    })
  if (
    command.action !== 'assign_next' &&
    !allowedEntryActions(
      state.config?.type ?? 'reception',
      entry.status,
    ).includes(input.action) &&
    !(input.action === 'no_show' && entry.status === 'called') &&
    !(input.action === 'restore' && entry.status === 'expired')
  )
    throw new HTTPException(409, { message: 'unsupported_action' })
  if (
    (input.action === 'prioritize' ||
      (input.action === 'pass' && entry.status === 'waiting')) &&
    entry.manual_only
  )
    throw new HTTPException(409, { message: 'manual_attention_required' })

  if (input.action === 'prioritize') {
    if (entry.status !== 'waiting')
      throw new HTTPException(409, { message: 'invalid_transition' })
    const party = state.parties.find((item) => item.id === input.entryId)
    if (!party)
      throw new HTTPException(409, { message: 'manual_attention_required' })
    const operationId = crypto.randomUUID()
    const currentEntry = await feedbackEntry(env, input.entryId)
    if (entry.priority_rank !== null) {
      const result: QueueCommandResult = {
        ok: true,
        outcome: {
          operationId,
          action: input.action,
          entry: currentEntry,
          automatic: false,
          cycleEnded: false,
          mode: 'already_prioritized',
        },
      }
      await env.DB.batch([
        audit(
          env,
          actor,
          access.organizationId,
          access.venueId,
          'queue.prioritize',
          input.entryId,
        ),
        env.DB.prepare(
          'INSERT INTO staff_command VALUES (?,?,?,?)',
        ).bind(actor, key, fingerprint, serializeStaffCommandResult(result)),
      ])
      return result
    }
    const queuePriority = await env.DB.prepare(
      'SELECT priority_counter FROM queue WHERE id=?',
    )
      .bind(queueId)
      .first<{ priority_counter: number }>()
    if (!queuePriority) throw new HTTPException(404, { message: 'not_found' })
    const priorityRank = queuePriority.priority_counter + 1
    const result: QueueCommandResult = {
      ok: true,
      outcome: {
        operationId,
        action: input.action,
        entry: currentEntry,
        automatic: false,
        cycleEnded: false,
        mode: 'prioritized',
      },
    }
    const after: QueueModelInput = {
      config: state.config,
      allocations: state.allocations.map((allocation) => ({ ...allocation })),
      holds: state.holds,
      parties: state.parties.map((item) =>
        item.id === input.entryId
          ? { ...item, priorityRank }
          : { ...item },
      ),
    }
    await commitQueueTransition(
      env,
      queueId,
      state,
      after,
      [
        env.DB.prepare(
          'UPDATE queue SET priority_counter=? WHERE id=? AND priority_counter=?',
        ).bind(priorityRank, queueId, queuePriority.priority_counter),
        env.DB.prepare(
          "UPDATE queue_entry SET priority_rank=?,version=version+1 WHERE id=? AND queue_id=? AND status='waiting' AND manual_only=0 AND version=? AND priority_rank IS NULL",
        ).bind(priorityRank, input.entryId, queueId, input.version),
        audit(
          env,
          actor,
          access.organizationId,
          access.venueId,
          'queue.prioritize',
          input.entryId,
        ),
        env.DB.prepare(
          'INSERT INTO staff_command VALUES (?,?,?,?)',
        ).bind(actor, key, fingerprint, serializeStaffCommandResult(result)),
      ],
      now,
      'staff.prioritize',
    )
    return result
  }

  if (input.action === 'pass') {
    const operationId = crypto.randomUUID()
    const currentEntry = await feedbackEntry(env, input.entryId)
    const currentParty: Party = {
      id: input.entryId,
      sequence: entry.sequence,
      partySize: entry.party_size,
      preferredSpaceId: entry.preferred_space_id,
      priorityRank: null,
    }
    if (entry.status === 'waiting') {
      const party = state.parties.find((item) => item.id === input.entryId)
      if (!party)
        throw new HTTPException(409, { message: 'manual_attention_required' })
      const context = resolveEstimateContext(party, state.config, state.baseline)
      const successor = nextPassSuccessor(
        party,
        state.parties,
        context,
        state.config?.type ?? null,
      )
      if (!successor)
        throw new HTTPException(409, { message: 'no_compatible_successor' })
      const sequence = exchangePassSequences(party, successor)
      const successorEntry = await feedbackEntry(env, successor.id)
      const result: QueueCommandResult = {
        ok: true,
        outcome: {
          operationId,
          action: input.action,
          entry: currentEntry,
          successor: successorEntry,
          automatic: false,
          cycleEnded: false,
          mode: 'waiting_swap',
        },
      }
      const after: QueueModelInput = {
        config: state.config,
        allocations: state.allocations.map((allocation) => ({ ...allocation })),
        holds: state.holds,
        parties: prepareWaitingPassParties(state.parties, party, successor),
      }
      await commitQueueTransition(
        env,
        queueId,
        state,
        after,
        [
          env.DB.prepare(
            "UPDATE queue_entry SET sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) WHERE id=? AND queue_id=? AND status='waiting' AND version=?",
          ).bind(queueId, input.entryId, queueId, input.version),
          env.DB.prepare(
            "UPDATE queue_entry SET sequence=?,version=version+1 WHERE id=? AND queue_id=? AND status='waiting' AND version=?",
          ).bind(sequence.successorSequence, successor.id, queueId, successor.version),
          env.DB.prepare(
            "UPDATE queue_entry SET sequence=?,priority_rank=NULL,version=version+1,call_cycle=call_cycle+1 WHERE id=? AND queue_id=? AND status='waiting' AND version=?",
          ).bind(sequence.currentSequence, input.entryId, queueId, input.version),
          env.DB.prepare(
            "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'staff_pass',?)",
          ).bind(crypto.randomUUID(), input.entryId, now),
          env.DB.prepare(
            "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'pass_received',?)",
          ).bind(crypto.randomUUID(), successor.id, now),
          audit(
            env,
            actor,
            access.organizationId,
            access.venueId,
            'queue.pass',
            input.entryId,
          ),
          env.DB.prepare(
            'INSERT INTO staff_command VALUES (?,?,?,?)',
          ).bind(actor, key, fingerprint, serializeStaffCommandResult(result)),
        ],
        now,
        'staff.pass',
      )
      await activateIfReady(env, queueId, now)
      return result
    }
    if (entry.status !== 'called')
      throw new HTTPException(409, { message: 'invalid_transition' })

    const selection = await selectAutomationSuccessor(
      env,
      queueId,
      state,
      input.entryId,
      entry.call_cycle,
      now,
    )
    const inherited = await readCallReplacement(env, input.entryId, entry.call_cycle)
    const notices = [
      env.DB.prepare(
        "INSERT OR IGNORE INTO notification_trace(id,notification_id,event,recorded_at) SELECT id||':obsolete',id,'obsolete',? FROM notification_outbox WHERE entry_id=? AND kind='ready' AND status='pending'",
      ).bind(now, input.entryId),
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE entry_id=? AND kind='ready' AND status='pending'",
      ).bind(now, input.entryId),
    ]
    if (selection.successor) {
      const successor = selection.successor
      const sequence = exchangePassSequences(currentParty, successor)
      const nextCycle = successor.call_cycle + 1
      const call = await prepareCall(env, queueId, state, successor, {
        now,
        callCycle: nextCycle,
        origin: 'staff_pass',
        context: selection.context,
        inherited,
      })
      const successorEntry = await feedbackEntry(env, successor.id)
      const result: QueueCommandResult = {
        ok: true,
        outcome: {
          operationId,
          action: input.action,
          entry: currentEntry,
          successor: successorEntry,
          automatic: call.automatic,
          cycleEnded: false,
          mode: 'called_handoff',
        },
      }
      const after: QueueModelInput = {
        config: state.config,
        allocations: state.allocations.map((allocation) => ({ ...allocation })),
        holds: state.holds,
        parties: prepareCalledPassParties(state.parties, currentParty, successor),
        appendedCallAt: now,
        assignment: call.assignment,
      }
      await commitQueueTransition(
        env,
        queueId,
        state,
        after,
        [
          ...notices,
          ...call.statements,
          finishCallReplacement(env, input.entryId, entry.call_cycle, 'yielded', now, {
            id: successor.id,
            cycle: nextCycle,
          }),
          env.DB.prepare(
            "UPDATE queue_entry SET sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) WHERE id=? AND queue_id=? AND status='called' AND version=? AND call_cycle=?",
          ).bind(queueId, input.entryId, queueId, input.version, entry.call_cycle),
          env.DB.prepare(
            "UPDATE queue_entry SET sequence=?,status='called',version=version+1,progress_initial_eta_minutes=COALESCE(progress_initial_eta_minutes,?),call_cycle=call_cycle+1,called_at=?,arrival_deadline_at=? WHERE id=? AND queue_id=? AND status='waiting' AND version=?",
          ).bind(
            sequence.successorSequence,
            call.graceMinutes,
            now,
            call.deadline,
            successor.id,
            queueId,
            successor.version,
          ),
          env.DB.prepare(
            "UPDATE queue_entry SET sequence=?,priority_rank=NULL,status='waiting',version=version+1,call_cycle=call_cycle+1,called_at=NULL,arrival_deadline_at=NULL WHERE id=? AND queue_id=? AND status='called' AND version=? AND call_cycle=?",
          ).bind(
            sequence.currentSequence,
            input.entryId,
            queueId,
            input.version,
            entry.call_cycle,
          ),
          env.DB.prepare(
            "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'staff_pass',?)",
          ).bind(crypto.randomUUID(), input.entryId, now),
          env.DB.prepare(
            "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'yield_received',?)",
          ).bind(crypto.randomUUID(), successor.id, now),
          env.DB.prepare(
            "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'called',?)",
          ).bind(crypto.randomUUID(), successor.id, now),
          audit(
            env,
            actor,
            access.organizationId,
            access.venueId,
            'queue.pass',
            input.entryId,
          ),
          env.DB.prepare(
            'INSERT INTO staff_command VALUES (?,?,?,?)',
          ).bind(actor, key, fingerprint, serializeStaffCommandResult(result)),
        ],
        now,
        'staff.pass',
      )
      await publishNotice(env, successor.id, 'ready')
      await activateIfReady(env, queueId, now)
      return result
    }

    const retained =
      !!entry.manual_only || (entry.service_ends_at !== null && entry.service_ends_at <= now)
    const currentAfter = { ...currentParty, sequence: entry.sequence }
    const result: QueueCommandResult = {
      ok: true,
      outcome: {
        operationId,
        action: input.action,
        entry: currentEntry,
        successor: null,
        automatic: false,
        cycleEnded: selection.cycle?.state === 'active',
        mode: 'returned_to_waiting',
      },
    }
    const after: QueueModelInput = {
      config: state.config,
      allocations: state.allocations.map((allocation) => ({ ...allocation })),
      holds: state.holds,
      parties: retained
        ? state.parties.filter((party) => party.id !== input.entryId)
        : prepareReturnedPassParties(state.parties, currentAfter),
    }
    await commitQueueTransition(
      env,
      queueId,
      state,
      after,
      [
        ...notices,
        finishCallReplacement(env, input.entryId, entry.call_cycle, 'returned_to_waiting', now),
        stopAutomation(env, input.entryId, entry.call_cycle, selection.result, now),
        env.DB.prepare(
          "UPDATE queue_entry SET priority_rank=NULL,status='waiting',version=version+1,call_cycle=call_cycle+1,called_at=NULL,arrival_deadline_at=NULL WHERE id=? AND queue_id=? AND status='called' AND version=? AND call_cycle=?",
        ).bind(input.entryId, queueId, input.version, entry.call_cycle),
        ...(retained
          ? [env.DB.prepare('UPDATE queue_entry SET manual_only=1 WHERE id=?').bind(input.entryId)]
          : []),
        env.DB.prepare(
          "INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,'staff_pass',?)",
        ).bind(crypto.randomUUID(), input.entryId, now),
        audit(
          env,
          actor,
          access.organizationId,
          access.venueId,
          'queue.pass',
          input.entryId,
        ),
        env.DB.prepare(
          'INSERT INTO staff_command VALUES (?,?,?,?)',
        ).bind(actor, key, fingerprint, serializeStaffCommandResult(result)),
      ],
      now,
      'staff.pass',
    )
    await activateIfReady(env, queueId, now)
    return result
  }
  const transitions: Record<string, readonly string[]> = {
    call: ['waiting'],
    complete: ['called'],
    release: ['completed'],
    cancel: ['waiting', 'called'],
    no_show: ['called'],
    skip: ['waiting'],
    restore: ['expired'],
  }
  if (!transitions[input.action]!.includes(entry.status))
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (
    input.action === 'restore' &&
    ((entry.service_ends_at !== null && now >= entry.service_ends_at) ||
      (entry.service_window_id === null &&
        (!state.config ||
          weeklySchedule(state.config).allDayDays.length !== 7)))
  )
    throw new HTTPException(409, { message: 'invalid_transition' })
  if (input.action === 'restore' && !input.overrideReason)
    throw new HTTPException(400, { message: 'restore_reason_required' })
  if (input.action === 'no_show') {
    let deadline = entry.arrival_deadline_at
    if (deadline === null && entry.called_at !== null) {
      const q = await env.DB.prepare('SELECT config FROM queue WHERE id=?')
        .bind(queueId)
        .first<{ config: string }>()
      const grace = (JSON.parse(q!.config) as { graceMinutes: number })
        .graceMinutes
      deadline = entry.called_at + grace * 60000
    }
    if (deadline === null || now < deadline)
      throw new HTTPException(409, { message: 'arrival_grace_active' })
  }
  const activeCycleBeforeEnd =
    input.action === 'complete' || input.action === 'cancel'
      ? await env.DB.prepare(
          "SELECT id FROM queue_automation_cycle WHERE queue_id=? AND current_entry_id=? AND current_call_cycle=? AND state='active' LIMIT 1",
        )
          .bind(queueId, input.entryId, entry.call_cycle)
          .first<{ id: string }>()
      : null
  const status = {
    call: input.arrivalMode === 'present' ? 'completed' : 'called',
    complete: 'completed',
    release: 'served',
    cancel: 'cancelled',
    no_show: 'no_show',
    skip: 'waiting',
    restore: 'waiting',
  }[input.action]
  const after: QueueModelInput = {
    config: state.config,
    allocations: state.allocations.map((a) => ({ ...a })),
    holds: state.holds,
    parties: state.parties.map((p) => ({ ...p })),
  }
  if (status !== 'waiting')
    after.parties = after.parties!.filter((p) => p.id !== input.entryId)
  if (input.action === 'skip') {
    const max = await env.DB.prepare(
      'SELECT MAX(sequence) AS sequence FROM queue_entry WHERE queue_id=?',
    )
      .bind(queueId)
      .first<{ sequence: number }>()
    after.parties = after.parties!.map((p) =>
      p.id === input.entryId ? { ...p, sequence: (max?.sequence ?? 0) + 1 } : p,
    )
  }
  if (input.action === 'restore') {
    const party = await env.DB.prepare(
      'SELECT id,sequence,party_size AS partySize,preferred_space_id AS preferredSpaceId FROM queue_entry WHERE id=?',
    )
      .bind(input.entryId)
      .first<{
        id: string
        sequence: number
        partySize: number
        preferredSpaceId: string | null
      }>()
    if (party) after.parties!.push(party)
  }
  if (input.action === 'call') after.appendedCallAt = now
  const extra: D1PreparedStatement[] = []
  let seatingContext: EstimateContext | undefined
  if (input.seating) {
    if (input.action !== 'call' || state.config?.type !== 'restaurant')
      throw new HTTPException(400, { message: 'invalid_assignment_seating' })
    const party = callParty!
    const options = assignmentTableOptions(state.config, party.partySize)
    if (input.seating.mode === 'unspecified') {
      if (options.length)
        throw new HTTPException(409, { message: 'assignment_seating_changed' })
      seatingContext = {
        spaceId: null,
        seats: null,
        provenance: 'general',
        baselineMinutes: configuredIntervalMinutes(
          state.config,
          state.baseline,
        ),
      }
    } else {
      const { spaceId, seats } = input.seating
      if (
        !options.some(
          (space) => space.spaceId === spaceId && space.seats.includes(seats),
        )
      )
        throw new HTTPException(409, { message: 'assignment_seating_changed' })
      seatingContext = {
        spaceId,
        seats,
        provenance: 'confirmed',
        baselineMinutes: configuredIntervalMinutes(
          state.config,
          state.baseline,
          spaceId,
          seats,
        ),
      }
    }
  }
  if (input.action === 'call') {
    const context = await assignmentContext(callState, input.entryId, now)
    if (input.assignmentToken && input.assignmentToken !== context.token)
      throw new HTTPException(409, { message: 'assignment_context_changed' })
  }
  if (input.action === 'restore')
    extra.push(
      env.DB.prepare(
        'INSERT INTO queue_override_audit VALUES (?,?,?,?,?,?)',
      ).bind(
        crypto.randomUUID(),
        queueId,
        input.entryId,
        actor,
        input.overrideReason!,
        now,
      ),
    )
  let notifyCancellation = false
  if (input.action === 'cancel') {
    const consent = await env.DB.prepare(
      "SELECT 1 FROM consent WHERE entry_id=? AND purpose='queue_updates' AND revoked_at IS NULL LIMIT 1",
    )
      .bind(input.entryId)
      .first()
    const mobile = await env.DB.prepare('SELECT 1 FROM mobile_entry_installation WHERE entry_id=?').bind(input.entryId).first()
    if (consent || mobile) {
      extra.push(
        ...lifecycleNoticeStatements(
          env,
          input.entryId,
          'cancelled',
          now,
          {
            schemaVersion: 2,
            serviceName: state.config?.name ?? 'Service',
            ahead: null,
            etaMinutes: null,
            predictedAt: null,
            estimateQuality: 'unknown',
            resourceName: null,
            arrivalDeadlineAt: null,
            reason: 'staff_cancel',
          },
          0,
          0,
          !!state.config,
        ),
      )
      notifyCancellation = true
    }
  }
  if (status !== 'waiting') {
    extra.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO notification_trace(id,notification_id,event,recorded_at) SELECT id||':obsolete',id,'obsolete',? FROM notification_outbox WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved') AND status='pending'",
      ).bind(now, input.entryId),
      env.DB.prepare(
        "UPDATE notification_outbox SET status='cancelled',updated_at=? WHERE entry_id=? AND kind IN ('queue_joined','approaching','delayed','improved') AND status='pending'",
      ).bind(now, input.entryId),
    )
  }
  let call: Awaited<ReturnType<typeof prepareCall>> | undefined
  if (input.action === 'call') {
    call = await prepareCall(
      env,
      queueId,
      callState,
      callParty!,
      {
        now,
        callCycle: entry.call_cycle + 1,
        origin: 'staff',
        context: seatingContext,
        present: input.arrivalMode === 'present',
      },
    )
    after.assignment = call.assignment
    extra.push(...call.statements)
  } else if (['complete', 'cancel', 'no_show'].includes(input.action)) {
    extra.push(stopAutomation(env, input.entryId, entry.call_cycle, input.action === 'complete' ? 'arrived' : input.action === 'cancel' ? 'cancelled' : 'no_show', now))
    extra.push(
      finishCallReplacement(
        env,
        input.entryId,
        entry.call_cycle,
        input.action === 'complete'
          ? 'arrived'
          : input.action === 'cancel'
          ? 'cancelled'
          : 'no_show',
        now,
      ),
    )
  }
  const commandResult: QueueCommandResult =
    input.action === 'call' ||
    input.action === 'complete' ||
    input.action === 'cancel'
      ? {
          ok: true,
          outcome: {
            operationId: crypto.randomUUID(),
            action: input.action,
            entry: await feedbackEntry(env, input.entryId),
            automatic: call?.automatic ?? false,
            cycleEnded: !!activeCycleBeforeEnd,
            mode:
              input.action === 'call'
                ? input.arrivalMode === 'present'
                  ? 'present'
                  : 'called'
                : input.action === 'cancel'
                  ? 'cancelled'
                  : 'completed',
          },
        }
      : { ok: true }
  await commitQueueTransition(
    env,
    queueId,
    state,
    after,
    [
      ...extra,
      env.DB.prepare(
        `UPDATE queue_entry SET status=?,version=version+1,priority_rank=CASE WHEN ?='cancel' THEN NULL ELSE priority_rank END,progress_initial_eta_minutes=COALESCE(progress_initial_eta_minutes,?),call_cycle=CASE WHEN ?='call' THEN call_cycle+1 ELSE call_cycle END,called_at=?,arrival_deadline_at=CASE WHEN ?='call' THEN ? WHEN ?='restore' THEN NULL ELSE arrival_deadline_at END,sequence=CASE WHEN ?='skip' THEN (SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=?) ELSE sequence END WHERE id=? AND queue_id=? AND version=?`,
      ).bind(
        status,
        input.action,
        input.action === 'call' && input.arrivalMode !== 'present'
          ? call!.graceMinutes
          : null,
        input.action,
        input.action === 'call'
          ? now
          : input.action === 'restore'
          ? null
          : entry.called_at,
        input.action,
        call?.deadline ?? null,
        input.action,
        input.action,
        queueId,
        input.entryId,
        queueId,
        input.version,
      ),
      env.DB.prepare(
        'INSERT INTO queue_event(id,entry_id,kind,created_at) VALUES (?,?,?,?)',
      ).bind(
        crypto.randomUUID(),
        input.entryId,
        input.action === 'restore'
          ? 'restored'
          : status === 'waiting'
          ? 'skipped'
          : status,
        now,
      ),
      audit(
        env,
        actor,
        access.organizationId,
        access.venueId,
        `queue.${command.action}`,
        input.entryId,
      ),
      env.DB.prepare('INSERT INTO staff_command VALUES (?,?,?,?)').bind(
        actor,
        key,
        fingerprint,
        serializeStaffCommandResult(commandResult),
      ),
    ],
    now,
    `staff.${input.action}`,
  )
  if (input.action === 'call' && input.arrivalMode !== 'present')
    await publishNotice(env, input.entryId, 'ready')
  if (notifyCancellation) await publishNotice(env, input.entryId, 'cancelled')
  await activateIfReady(env, queueId, now)
  return commandResult
}
export async function configureQueue(
  env: CloudflareBindings,
  actor: string,
  queueId: string,
  body: unknown,
) {
  const now = Date.now()
  const access = await queueAccess(env, actor, queueId, 'queue.configure')
  await maintainQueue(env, queueId, now)
  const parsed = queueSettingsSchema.safeParse(body)
  if (!parsed.success)
    throw new HTTPException(400, { message: 'invalid_settings' })
  const { version, open, applyApproachToActive, ...rawConfig } = parsed.data
  const current = await env.DB.prepare(
    'SELECT version,open FROM queue WHERE id=?',
  )
    .bind(queueId)
    .first<{ version: number; open: number }>()
  if (!current || current.version !== version)
    throw new HTTPException(409, { message: 'version_conflict' })
  const old = await loadQueueState(env, queueId, now)
  if (old.config?.scheduleGroups && !rawConfig.scheduleGroups)
    throw new HTTPException(409, { message: 'schedule_format_conflict' })
  const config = normalizeConfig({ ...rawConfig, automaticAssignmentEnabled: rawConfig.automaticAssignmentEnabled ?? old.config?.automaticAssignmentEnabled ?? false }, old.config)
  if (
    config.graceMinutes !== old.config?.graceMinutes &&
    (await env.DB.prepare(
      "SELECT 1 FROM queue_entry WHERE queue_id=? AND status='called' AND arrival_deadline_at IS NULL LIMIT 1",
    )
      .bind(queueId)
      .first())
  )
    throw new HTTPException(409, { message: 'legacy_arrival_deadline' })
  const approachChanged =
    (config.approachMinutes ?? 10) !== (old.config?.approachMinutes ?? 10) ||
    (config.etaChangeThresholdMinutes ?? 5) !==
      (old.config?.etaChangeThresholdMinutes ?? 5) ||
    (config.notificationCooldownMinutes ?? 10) !==
      (old.config?.notificationCooldownMinutes ?? 10)
  if (approachChanged && old.parties.length && !applyApproachToActive)
    throw new HTTPException(409, {
      message: 'active_approach_confirmation_required',
    })
  if (
    rawConfig.intelligencePolicy !== undefined &&
    rawConfig.intelligencePolicy !==
      (old.config?.intelligencePolicy ?? 'automatic')
  )
    throw new HTTPException(409, { message: 'lifecycle_command_required' })
  config.intelligencePolicy = old.config?.intelligencePolicy ?? 'automatic'
  if (
    open !== !!current.open ||
    (config.estimationMode ?? 'shadow') !==
      (old.config?.estimationMode ?? 'shadow')
  )
    throw new HTTPException(409, { message: 'lifecycle_command_required' })
  const adjustmentsChanged =
    rawConfig.adjustments !== undefined &&
    JSON.stringify(config.adjustments) !==
      JSON.stringify(old.config?.adjustments)
  if (adjustmentsChanged)
    throw new HTTPException(410, { message: 'operation_retired' })
  // New clients need not echo retired inventory fields. Preserve the historical
  // values without allowing them to gate or alter queue configuration.
  config.resourceStateKnown = old.config?.resourceStateKnown
  config.adjustments = old.config?.adjustments
  const preferences = await env.DB.prepare(
    "SELECT preferred_space_id,party_size FROM queue_entry WHERE queue_id=? AND status IN ('waiting','called') AND preferred_space_id IS NOT NULL AND preferred_space_id!='fastest'",
  )
    .bind(queueId)
    .all<{ preferred_space_id: string; party_size: number }>()
  if (
    preferences.results.some(
      (entry) =>
        config.type !== 'restaurant' ||
        !config.spaces.some((space) => space.id === entry.preferred_space_id),
    )
  )
    throw new HTTPException(409, { message: 'preferred_space_in_use' })
  // Operational adjustments do not redefine the establishment configuration.
  const configurationOnly = (value: ServiceInput) => {
    const {
      adjustments: _adjustments,
      resourceStateKnown: _known,
      estimationMode: _mode,
      ...configuration
    } = value
    return {
      ...configuration,
      approachTurns: value.approachTurns ?? 2,
      approachMinutes: value.approachMinutes ?? 10,
      etaChangeThresholdMinutes: value.etaChangeThresholdMinutes ?? 5,
      notificationCooldownMinutes: value.notificationCooldownMinutes ?? 10,
      intelligencePolicy: value.intelligencePolicy ?? 'automatic',
      automaticAssignmentEnabled: value.automaticAssignmentEnabled ?? false,
    }
  }
  const configurationChanged =
    !old.config ||
    !sameConfiguration(configurationOnly(config), configurationOnly(old.config))
  if (!configurationChanged && !adjustmentsChanged) return { ok: true }
  await commitQueueTransition(
    env,
    queueId,
    old,
    {
      config,
      allocations: old.allocations,
      parties: old.parties,
      holds: old.holds,
    },
    [
      env.DB.prepare(
        'UPDATE queue SET capacity=?,average_minutes=?,open=?,name=?,config=?,version=version+1 WHERE id=? AND version=?',
      ).bind(
        config.capacity,
        config.averageMinutes,
        Number(open),
        config.name,
        JSON.stringify(config),
        queueId,
        version,
      ),
      ...(configurationChanged
        ? [touchVenueConfiguration(env, access.venueId, Date.now(), true)]
        : []),
      ...(!config.automaticAssignmentEnabled ? [stopQueueAutomation(env, queueId, 'disabled', now)] : []),
      directoryConfigStatement(env, queueId, JSON.stringify(config)),
      audit(
        env,
        actor,
        access.organizationId,
        access.venueId,
        'queue.configured',
        queueId,
      ),
    ],
    now,
  )
  return { ok: true }
}
