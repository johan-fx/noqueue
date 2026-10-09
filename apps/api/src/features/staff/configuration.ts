/** Include in the same D1 batch as the successful configuration mutation. */
export function touchVenueConfiguration(
  env: CloudflareBindings,
  venueId: string,
  now = Date.now(),
  requirePreviousChange = false,
) {
  return env.DB.prepare(
    `UPDATE venue SET configuration_updated_at=? WHERE id=?${
      requirePreviousChange ? ' AND changes()=1' : ''
    }`,
  ).bind(now, venueId)
}

/** JSON object order is not a configuration change; array order remains meaningful. */
export function sameConfiguration(left: unknown, right: unknown): boolean {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => [key, canonical(v)]),
      )
    return value
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
