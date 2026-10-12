/** Reload the current URL without changing or clearing any browser storage. */
export function reloadCurrentPage(): void {
  if (typeof window !== 'undefined') window.location.reload()
}
