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
