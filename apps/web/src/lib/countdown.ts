/** Absolute deadlines are authoritative; a positive fraction is still one second. */
export function formatCountdown(remainingMs: number | null): string {
  if (remainingMs == null || !Number.isFinite(remainingMs)) return '—'
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
