type LogoEnvironment = Pick<CloudflareBindings,
  'VENUE_LOGOS_ENABLED' | 'VENUE_LOGOS_PUBLIC_BASE_URL'> & { VENUE_LOGOS?: R2Bucket }

export function venueLogosEnabled(env: LogoEnvironment): boolean {
  return env.VENUE_LOGOS_ENABLED !== 'false' && !!env.VENUE_LOGOS
}

/** Shared public asset URL; never exposes upload metadata or editing rights. */
export function venueLogoUrl(
  env: LogoEnvironment,
  key: string | null,
): string | null {
  if (!venueLogosEnabled(env) || !key) return null
  const base =
    env.VENUE_LOGOS_PUBLIC_BASE_URL?.replace(/\/$/, '') || '/api/v1/venue-logos'
  return `${base}/${key}`
}
