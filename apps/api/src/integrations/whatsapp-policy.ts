/** Open real V4 testing is confined to the explicitly configured staging channel. */
export function isOpenStagingV4(env: {
  APP_ENV?: string
  WHATSAPP_MODE?: string
  WHATSAPP_COPY_VERSION?: string
}) {
  return (
    env.APP_ENV === 'staging' &&
    env.WHATSAPP_MODE === 'cloud' &&
    env.WHATSAPP_COPY_VERSION === '4'
  )
}

/** Production is a separate opt-in, never authorized by staging/pilot flags. */
export function isApprovedProductionV4(env: {
  APP_ENV?: string
  PUBLIC_APP_ORIGIN?: string
  WHATSAPP_MODE?: string
  WHATSAPP_COPY_VERSION?: string
  WHATSAPP_ENABLED?: string
  PRODUCTION_WHATSAPP_APPROVED?: string
  WHATSAPP_V4_TEMPLATES_APPROVED?: string
  D360DIALOG_API_KEY?: string
  D360DIALOG_PHONE_NUMBER_ID?: string
}) {
  return env.APP_ENV === 'production' &&
    env.PUBLIC_APP_ORIGIN === 'https://app.noqueue-app.com' &&
    env.WHATSAPP_MODE === 'cloud' && env.WHATSAPP_COPY_VERSION === '4' &&
    env.WHATSAPP_ENABLED === 'true' &&
    env.PRODUCTION_WHATSAPP_APPROVED === 'true' &&
    env.WHATSAPP_V4_TEMPLATES_APPROVED === 'true' &&
    Boolean(env.D360DIALOG_API_KEY?.trim()) && Boolean(env.D360DIALOG_PHONE_NUMBER_ID?.trim())
}

export function isOpenCloudV4(env: Parameters<typeof isApprovedProductionV4>[0]) {
  return isOpenStagingV4(env) || isApprovedProductionV4(env)
}
