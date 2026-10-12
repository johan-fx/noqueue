/** Recognise loading failures, not arbitrary TypeErrors thrown by application code. */
export function isModuleLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('message' in error)) return false
  if (typeof error.message !== 'string') return false
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading (?:css )?chunk [\s\S]*failed|unable to preload css/i.test(
    error.message,
  )
}
