/** Server-only, opt-in exception. Never infer this policy from request data. */
export function stagingSilentAdmission(env: CloudflareBindings) {
  return env.APP_ENV === 'staging' &&
    env.STAGING_ALLOW_JOIN_WITHOUT_WHATSAPP === 'true' &&
    env.WHATSAPP_ENABLED === 'false'
}

/** Expressions must be trusted SQL identifiers, never caller input. */
export function whatsappEligibleSql(entryId: string) {
  return `EXISTS (SELECT 1 FROM queue_entry wa_entry WHERE wa_entry.id=${entryId} AND wa_entry.whatsapp_suppressed=0)`
}
