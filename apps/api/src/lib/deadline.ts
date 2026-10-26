export class ReadDeadlineError extends Error {
  constructor() { super('temporarily_unavailable') }
}

// Does not retry or cancel a database operation; a late result is never accepted.
export async function readDeadline<T>(operation: Promise<T>, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadDeadlineError()), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
