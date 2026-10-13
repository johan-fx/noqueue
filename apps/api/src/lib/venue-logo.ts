/** Shared public asset URL; never exposes upload metadata or editing rights. */
export function venueLogoUrl(
  env: Pick<CloudflareBindings, 'VENUE_LOGOS_PUBLIC_BASE_URL'>,
  key: string | null,
): string | null {
  if (!key) return null
  const base =
    env.VENUE_LOGOS_PUBLIC_BASE_URL?.replace(/\/$/, '') || '/api/v1/venue-logos'
  return `${base}/${key}`
}
