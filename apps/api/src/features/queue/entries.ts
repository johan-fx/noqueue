import {
  copyVersion,
  whatsappV3Catalog,
  v3TemplateReady,
} from '../../integrations/whatsapp-copy-v3'
import {
  whatsappV4CatalogForEnvironment,
  v4EnvironmentForOrigin,
  v4TemplateReady,
} from '../../integrations/whatsapp-copy-v4'
import { maintainServiceEntries } from './service-expiry'
import { customerPhase } from './customer'
import { publicService } from './public-context'
import { normalizeConfig, recalculateQueue, readProjection } from './projection'
import { unavailableCopyStatement, type QueueNoticeSnapshot } from './notices'
import { storedServiceSchema as serviceSchema } from '@noqueue/contracts/staff'
import { queueAccess, audit } from '../../auth/access'
import { admissionState, serviceDeadline } from '../staff/availability'
import {
  entrySchema,
  publicServiceConsentVersion,
  type JoinQueue,
  type ManualJoin,
  type Entry,
} from '@noqueue/contracts/queue'
import { readConfirmation } from './confirmation'
import {
  encryptPhone,
  encryptDisplayName,
  decryptDisplayName,
  hash,
  hmac,
  phoneHash,
  recoveryToken,
} from './crypto'

interface StoredEntry {
  id: string
  code: string
  queue_id: string
  sequence: number
  request_hash: string
  status: string
}
export async function readEntry(
  env: CloudflareBindings,
  token: string,
): Promise<Entry | null> {
  const entry = await env.DB.prepare(
    'SELECT id,code,queue_id,sequence,request_hash,status FROM queue_entry WHERE recovery_hash=?',
  )
    .bind(await hash(token))
    .first<StoredEntry>()
  if (!entry) return null
  return (
    env.APP_ENV === 'local'
      ? env.QUEUE_COORDINATOR
      : env.QUEUE_COORDINATOR.jurisdiction('eu')
  )
    .getByName(entry.queue_id)
    .read(entry.queue_id, token)
}
export async function readEntrySnapshot(
  env: CloudflareBindings,
  token: string,
): Promise<Entry | null> {
  const entry = await env.DB.prepare(
    'SELECT id,code,queue_id,sequence,request_hash,status FROM queue_entry WHERE recovery_hash=?',
  )
    .bind(await hash(token))
    .first<StoredEntry>()
  return entry ? presentEntry(env, entry) : null
}

async function presentEntry(env: CloudflareBindings, entry: StoredEntry) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM queue_entry WHERE queue_id=? AND status='waiting' AND sequence<=?) AS position,
    e.progress_initial_eta_minutes, q.average_minutes, COALESCE(n.status,'disabled') AS notification FROM queue q JOIN queue_entry e ON e.id=? LEFT JOIN notification_outbox n ON n.id=(SELECT latest.id FROM notification_outbox latest WHERE latest.entry_id=? ORDER BY latest.rowid DESC LIMIT 1) WHERE q.id=?`,
  )
    .bind(entry.queue_id, entry.sequence, entry.id, entry.id, entry.queue_id)
    .first<{
      position: number
      progress_initial_eta_minutes: number | null
      average_minutes: number
      notification: string
    }>()
  if (!row) throw new Error('Entry queue missing')
  const projection = await readProjection(env, entry.id)
  const service = await publicService(env, entry.queue_id)
  let customer
  if (service) {
    const detail = await env.DB.prepare(
      `SELECT e.display_name_cipher,e.party_size,e.preferred_space_id,e.locale,e.version,e.created_at,e.called_at,e.arrival_deadline_at,q.config,EXISTS(SELECT 1 FROM queue_event WHERE entry_id=e.id AND kind='service_ended') AS service_ended,(SELECT MAX(created_at) FROM queue_event WHERE entry_id=e.id AND kind='completed') AS arrived_at FROM queue_entry e JOIN queue q ON q.id=e.queue_id WHERE e.id=?`,
    )
      .bind(entry.id)
      .first<{
        display_name_cipher: string | null
        party_size: number
        preferred_space_id: string | null
        locale: string
        version: number
        created_at: number
        called_at: number | null
        arrival_deadline_at: number | null
        config: string
        arrived_at: number | null
        service_ended: number
      }>()
    if (detail) {
      const phase = customerPhase(
        entry.status,
        projection?.position ?? row.position,
        projection?.etaMinutes ?? 0,
        projection?.estimateQuality,
        JSON.parse(detail.config),
      )
      customer = {
        service,
        displayName: detail.display_name_cipher
          ? await decryptDisplayName(
              env.PII_ENCRYPTION_KEY,
              detail.display_name_cipher,
            )
          : null,
        partySize: detail.party_size,
        preferredSpaceId: detail.preferred_space_id,
        locale: detail.locale,
        version: detail.version,
        serverNow: Date.now(),
        createdAt: detail.created_at,
        calledAt: detail.called_at,
        arrivalDeadlineAt: detail.arrival_deadline_at,
        arrivedAt: detail.arrived_at,
        phase,
        ...(detail.service_ended ? { cancellationReason: 'service_ended' as const } : {}),
        actions:
          phase === 'waiting' || phase === 'approaching'
            ? service.type === 'restaurant'
              ? ['update', 'cancel', 'yield']
              : ['cancel', 'yield']
            : phase === 'called'
              ? ['cancel', 'yield']
            : [],
      }
    }
  }
  return entrySchema.parse({
    customer,
    initialEtaMinutes: row.progress_initial_eta_minutes,
    code: entry.code,
    position: entry.status === 'waiting' ? row.position : 0,
    etaMinutes: 0,
    ...(entry.status === 'waiting'
      ? projection ?? { estimateQuality: 'unknown', predictedAt: null }
      : {}),
    status: entry.status,
    notification: row.notification,
    ...(await readConfirmation(env, entry.id)),
  })
}
// Only a server-configured loopback development instance may admit offline manual turns.
export function manualJoinRequiresWhatsapp(env: CloudflareBindings) {
  if (env.APP_ENV !== 'local') return true
  try {
    return !['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(env.PUBLIC_APP_ORIGIN).hostname,
    )
  } catch {
    return true
  }
}
export type JoinSource = 'legacy' | 'public-service' | 'public-queue'

function whatsappAdmissionReady(
  env: CloudflareBindings,
  locale: 'es' | 'en',
) {
  if (
    env.WHATSAPP_ENABLED !== 'true' ||
    !env.D360DIALOG_API_KEY ||
    !env.D360DIALOG_PHONE_NUMBER_ID ||
    !['sandbox', 'cloud'].includes(env.WHATSAPP_MODE)
  )
    return false
  const profile = copyVersion(env)
  if (profile === null) return false
  if (env.WHATSAPP_MODE === 'cloud' && profile === 3)
    return whatsappV3Catalog
      .filter((template) => template.locale === locale)
      .every((template) => v3TemplateReady(env, template))
  if (env.WHATSAPP_MODE === 'cloud' && profile === 4) {
    const environment = v4EnvironmentForOrigin(env.PUBLIC_APP_ORIGIN)
    return (
      environment !== null &&
      whatsappV4CatalogForEnvironment(environment)
        .filter((template) => template.locale === locale)
        .every((template) => v4TemplateReady(env, template))
    )
  }
  if (env.WHATSAPP_MODE === 'cloud') {
    const templates = env as CloudflareBindings &
      Partial<
        Record<
          'WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_ES' |
            'WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_EN',
          string
        >
      >
    const template =
      locale === 'es'
        ? templates.WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_ES
        : templates.WHATSAPP_QUEUE_V2_QUEUE_JOINED_TEMPLATE_EN
    if (
      env.STAGING_CONSENT_APPROVED !== 'true' ||
      env.WHATSAPP_V2_TEMPLATES_APPROVED !== 'true' ||
      !template
    )
      return false
  }
  return true
}

function recipientAllowed(env: CloudflareBindings, phone: string) {
  return (env.WHATSAPP_RECIPIENT_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes(phone)
}

export function publicWhatsappAdmissionError(
  env: CloudflareBindings,
  contact:
    | { consent: false }
    | { consent: true; phone: string; version: string },
  locale: 'es' | 'en',
) {
  if (!manualJoinRequiresWhatsapp(env)) return null
  if (!contact.consent) return 'whatsapp_consent_required'
  if (contact.version !== publicServiceConsentVersion)
    return 'whatsapp_consent_version_required'
  if (!whatsappAdmissionReady(env, locale)) return 'whatsapp_unavailable'
  if (!recipientAllowed(env, contact.phone)) return 'recipient_not_allowed'
  return null
}

export async function joinQueue(
  env: CloudflareBindings,
  queueId: string,
  key: string,
  input: JoinQueue | ManualJoin,
  experiment = false,
  actor?: string,
  source: JoinSource = 'legacy',
) {
  await maintainServiceEntries(env, queueId)
  const access = actor
    ? await queueAccess(env, actor, queueId, 'queue.operate')
    : null
  // Actor-scoped namespace prevents public keys colliding with manual entries.
  if (actor) key = `staff:${actor}:${key}`
  const requestHash = await hmac(
    env.RECOVERY_TOKEN_KEY,
    `join-fingerprint:v1:${experiment ? 'confirmation:' : ''}${JSON.stringify(
      input,
    )}`,
  )
  const existing = await env.DB.prepare(
    'SELECT id,code,queue_id,sequence,request_hash,status FROM queue_entry WHERE queue_id=? AND idempotency_key=?',
  )
    .bind(queueId, key)
    .first<StoredEntry>()
  if (existing) {
    if (existing.request_hash !== requestHash)
      return { status: 409, body: { error: 'idempotency_conflict' } }
    await recalculateQueue(env, queueId)
    const latest = await env.DB.prepare('SELECT id,code,queue_id,sequence,request_hash,status FROM queue_entry WHERE id=?').bind(existing.id).first<StoredEntry>()
    return {
      status: 200,
      body: {
        ...(await presentEntry(env, latest!)),
        recoveryToken: await recoveryToken(env, existing.id),
      },
    }
  }
  const selectedCopyVersion = copyVersion(env)
  // Admission guards apply to new turns, never to recovery of a committed request.
  if (source === 'public-service' && !input.displayName?.trim())
    return { status: 400, body: { error: 'name_required' } }
  if (
    (source === 'public-service' || source === 'public-queue') &&
    manualJoinRequiresWhatsapp(env)
  ) {
    const admissionError = publicWhatsappAdmissionError(
      env,
      input.whatsapp,
      input.locale,
    )
    if (admissionError)
      return {
        status:
          admissionError === 'whatsapp_unavailable'
            ? 503
            : admissionError === 'recipient_not_allowed'
            ? 403
            : 400,
        body: { error: admissionError },
      }
  }
  if (actor && manualJoinRequiresWhatsapp(env)) {
    if (!input.whatsapp.consent)
      return { status: 400, body: { error: 'whatsapp_consent_required' } }
    if (env.WHATSAPP_ENABLED !== 'true')
      return { status: 503, body: { error: 'whatsapp_unavailable' } }
  }
  if (
    experiment &&
    input.whatsapp.consent &&
    queueId === 'confirmation-experiment'
  ) {
    const stopped = await env.DB.prepare(
      'SELECT 1 FROM whatsapp_contact_state WHERE phone_hash=? AND stopped_at IS NOT NULL',
    )
      .bind(await phoneHash(env, input.whatsapp.phone))
      .first()
    if (stopped) return { status: 403, body: { error: 'contact_stopped' } }
    const uncertain = await env.DB.prepare(
      `SELECT 1 FROM notification_outbox n JOIN queue_entry_contact p ON p.entry_id=n.entry_id
       JOIN queue_entry e ON e.id=n.entry_id WHERE e.queue_id=? AND p.phone_hash=? AND n.status IN ('sending','unknown') LIMIT 1`,
    )
      .bind(queueId, await phoneHash(env, input.whatsapp.phone))
      .first()
    if (uncertain)
      return { status: 409, body: { error: 'unknown_delivery_unresolved' } }
    const active = await env.DB.prepare(
      "SELECT 1 FROM queue_entry_contact p JOIN queue_entry e ON e.id=p.entry_id WHERE e.queue_id=? AND e.status='waiting' LIMIT 1",
    )
      .bind(queueId)
      .first()
    if (active)
      return {
        status: 409,
        body: { error: 'experiment_tester_already_waiting' },
      }
  }
  const queue = await env.DB.prepare(
    `SELECT q.capacity,q.open,q.average_minutes,q.config,v.timezone,v.organization_id,
    (SELECT status FROM tenant_account WHERE organization_id=v.organization_id) AS tenant_status,
    (SELECT COALESCE(SUM(party_size),0) FROM queue_entry WHERE queue_id=q.id AND status='waiting') AS waiting_people,
    (SELECT COUNT(*) FROM queue_entry WHERE queue_id=q.id AND status='waiting') AS waiting,
    (SELECT COALESCE(MAX(sequence),0)+1 FROM queue_entry WHERE queue_id=q.id) AS sequence
    FROM queue q JOIN venue v ON v.id=q.venue_id WHERE q.id=?`,
  )
    .bind(queueId)
    .first<{
      config: string | null
      timezone: string
      tenant_status: string | null
      waiting_people: number
      capacity: number
      open: number
      average_minutes: number
      organization_id: string
      waiting: number
      sequence: number
    }>()
  if (!queue) return { status: 404, body: { error: 'queue_not_found' } }
  if (
    !experiment &&
    input.whatsapp.consent &&
    selectedCopyVersion !== 2 &&
    !queue.config &&
    manualJoinRequiresWhatsapp(env)
  )
    return { status: 503, body: { error: 'whatsapp_unavailable' } }
  let snapshot: { windowId: string; endsAt: number | null } | null = null
  if (queue.config) {
    const config = normalizeConfig(
      serviceSchema.parse(JSON.parse(queue.config)),
    )
    if (
      source === 'public-service' &&
      config.type === 'pool' &&
      input.partySize !== 1
    )
      return { status: 400, body: { error: 'invalid_party_size' } }
    if (
      source === 'public-service' &&
      config.type === 'reception' &&
      !input.receptionService
    )
      return { status: 400, body: { error: 'invalid_reception_service' } }
    if (
      input.receptionService &&
      (config.type !== 'reception' ||
        !config.receptionServices.includes(input.receptionService))
    )
      return { status: 400, body: { error: 'invalid_reception_service' } }
    if (
      config.type === 'restaurant' &&
      !config.spaces.some((space) =>
        space.tableTypes?.some(
          (type) => type.count > 0 && type.seats >= input.partySize,
        ),
      )
    )
      return { status: 400, body: { error: 'invalid_party_size' } }
    if (input.preferredSpaceId) {
      const spaces =
        input.preferredSpaceId === 'fastest'
          ? config.spaces
          : config.spaces.filter((space) => space.id === input.preferredSpaceId)
      if (
        config.type !== 'restaurant' ||
        !spaces.some(
          (space) =>
            !space.tableTypes?.length ||
            space.tableTypes.some(
              (type) => type.count > 0 && type.seats >= input.partySize,
            ),
        )
      )
        return { status: 400, body: { error: 'invalid_space_preference' } }
    }
    if (
      queue.tenant_status !== 'active' ||
      !(await admissionState(env, queueId))?.canJoin ||
      (config.type === 'pool' &&
        queue.waiting_people + input.partySize > queue.capacity)
    )
      return { status: 409, body: { error: 'queue_unavailable' } }
    snapshot = serviceDeadline(config, queue.timezone)
    if (!snapshot) return { status: 409, body: { error: 'queue_unavailable' } }
  }
  if ((!queue.config && !queue.open) || queue.waiting >= queue.capacity)
    return { status: 409, body: { error: 'queue_unavailable' } }
  const id = crypto.randomUUID(),
    now = Date.now(),
    token = await recoveryToken(env, id)
  const joinedV4Snapshot: QueueNoticeSnapshot | null =
    selectedCopyVersion === 4 && queue.config
      ? {
          schemaVersion: 2,
          copyVersion: 4,
          copyVariant: 'queue_joined',
          serviceName:
            (JSON.parse(queue.config) as { name?: string }).name ?? 'Service',
          ahead: null,
          etaMinutes: null,
          predictedAt: null,
          estimateQuality: 'unknown',
          resourceName: null,
          arrivalDeadlineAt: null,
          projectionPending: true,
        }
      : null
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code = Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (b) => alphabet[b % alphabet.length],
  ).join('')
  const statements = [
    env.DB.prepare(
      `INSERT INTO queue_entry(id,queue_id,idempotency_key,request_hash,recovery_hash,code,party_size,locale,created_at,sequence,display_name_cipher,reception_service,preferred_space_id,service_window_id,service_ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      queueId,
      key,
      requestHash,
      await hash(token),
      code,
      input.partySize,
      input.locale,
      now,
      queue.sequence,
      input.displayName
        ? await encryptDisplayName(env.PII_ENCRYPTION_KEY, input.displayName)
        : null,
      input.receptionService ?? null,
      input.preferredSpaceId ?? null,
      snapshot?.windowId ?? null,
      snapshot?.endsAt ?? null,
    ),
    env.DB.prepare('INSERT INTO queue_event VALUES (?,?,?,?)').bind(
      crypto.randomUUID(),
      id,
      'joined',
      now,
    ),
  ]
  if (actor && access)
    statements.push(
      audit(
        env,
        actor,
        access.organizationId,
        access.venueId,
        'queue.join',
        id,
      ),
    )
  if (input.whatsapp.consent) {
    statements.push(
      env.DB.prepare('INSERT INTO queue_entry_contact VALUES (?,?,?)').bind(
        id,
        await encryptPhone(env.PII_ENCRYPTION_KEY, input.whatsapp.phone),
        await phoneHash(env, input.whatsapp.phone),
      ),
      env.DB.prepare('INSERT INTO consent VALUES (?,?,?,?,?,?,NULL)').bind(
        crypto.randomUUID(),
        id,
        queue.organization_id,
        experiment ? 'confirmation_contact' : 'queue_updates',
        experiment ? 'confirmation-experiment-v1' : input.whatsapp.version,
        now,
      ),
      !experiment && selectedCopyVersion !== 2 && !queue.config
        ? unavailableCopyStatement(env, id, 'queue_joined', now, `joined:${id}`, id)
        : joinedV4Snapshot
        ? env.DB.prepare(
            'INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind,payload_version,payload_snapshot,revision) VALUES (?,?,?,?,?,?,2,?,0)',
          ).bind(
            id,
            id,
            `joined:${id}`,
            env.WHATSAPP_ENABLED === 'true' ? 'pending' : 'cancelled',
            now,
            'queue_joined',
            JSON.stringify(joinedV4Snapshot),
          )
        : env.DB.prepare(
        'INSERT INTO notification_outbox(id,entry_id,idempotency_key,status,updated_at,kind) VALUES (?,?,?,?,?,?)',
      ).bind(
        id,
        id,
        `joined:${id}`,
        env.WHATSAPP_ENABLED === 'true' ? 'pending' : 'cancelled',
        now,
        experiment ? 'confirmation' : 'queue_joined',
      ),
    )
    if (experiment)
      statements.push(
        env.DB.prepare(
          'INSERT INTO queue_confirmation(entry_id,payload,contact_authorized_at,expires_at) VALUES (?,?,?,?)',
        ).bind(id, crypto.randomUUID(), now, now + 15 * 60 * 1000),
      )
  }
  await env.DB.batch(statements)
  const projectionState = await recalculateQueue(env, queueId)
  if (
    input.whatsapp.consent &&
    projectionState.config &&
    selectedCopyVersion !== 4
  ) {
    const projection = projectionState.projections.find((item) => item.id === id)
    const revision = await env.DB.prepare(
      'SELECT revision FROM queue_projection WHERE entry_id=?',
    )
      .bind(id)
      .first<{ revision: number }>()
    if (projection) {
      const snapshot: QueueNoticeSnapshot = {
        schemaVersion: 2,
        approachRecommended:
          customerPhase(
            'waiting',
            projection.position,
            projection.etaMinutes,
            projection.quality,
            {
              approachTurns: projectionState.config.approachTurns ?? 2,
              approachMinutes: projectionState.config.approachMinutes ?? 10,
            },
          ) === 'approaching',
        serviceName: projectionState.config.name,
        ahead: Math.max(0, projection.position - 1),
        etaMinutes:
          projection.quality === 'unknown' ? null : projection.etaMinutes,
        predictedAt: projection.predictedAt,
        estimateQuality: projection.quality,
        resourceName: null,
        arrivalDeadlineAt: null,
      }
      await env.DB.prepare(
        "UPDATE notification_outbox SET payload_version=2,payload_snapshot=?,revision=?,updated_at=? WHERE id=? AND kind='queue_joined' AND status='pending'",
      )
        .bind(
          JSON.stringify({
            ...snapshot,
            copyVersion: selectedCopyVersion ?? 'invalid',
          }),
          revision?.revision ?? 0,
          Date.now(),
          id,
        )
        .run()
    }
  }
  // Publishing is best-effort only after the durable transaction. The scheduled sweep repairs this gap.
  if (input.whatsapp.consent && env.WHATSAPP_ENABLED === 'true') {
    try {
      await env.NOTIFICATIONS.send({
        kind: 'dispatch-notification',
        notificationId: id,
      })
    } catch {
      console.warn('notification_publish_deferred')
    }
  }
  // Recalculation may close this service after admission committed the ticket.
  const latest = await env.DB.prepare(
    'SELECT id,code,queue_id,sequence,request_hash,status FROM queue_entry WHERE id=?',
  ).bind(id).first<StoredEntry>()
  return {
    status: 201,
    body: {
      ...(await presentEntry(env, latest!)),
      recoveryToken: token,
    },
  }
}
