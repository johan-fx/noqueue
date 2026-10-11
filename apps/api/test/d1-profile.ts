import type { env } from 'cloudflare:workers'

export function profileD1(bindings: typeof env) {
  const costs: Array<{ sql: string; rowsRead: number }> = []
  const statements = new WeakMap<
    D1PreparedStatement,
    { statement: D1PreparedStatement; sql: string }
  >()
  const wrap = (
    statement: D1PreparedStatement,
    sql: string,
  ): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === 'bind')
          return (...values: unknown[]) => wrap(target.bind(...values), sql)
        if (key === 'all' || key === 'run' || key === 'first')
          return async (...args: unknown[]) => {
            const result =
              key === 'run' ? await target.run() : await target.all()
            costs.push({ sql, rowsRead: result.meta.rows_read })
            return key === 'first'
              ? typeof args[0] === 'string'
                ? result.results[0]?.[args[0]] ?? null
                : result.results[0] ?? null
              : result
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    statements.set(wrapped, { statement, sql })
    return wrapped
  }
  const DB = new Proxy(bindings.DB, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => wrap(target.prepare(sql), sql)
      if (key === 'batch')
        return async (batch: D1PreparedStatement[]) => {
          const originals = batch.map((statement) => statements.get(statement))
          const results = await target.batch(
            originals.map(
              (original, index) => original?.statement ?? batch[index]!,
            ),
          )
          for (const [index, result] of results.entries())
            costs.push({
              sql: originals[index]?.sql ?? 'unprofiled batch statement',
              rowsRead: result.meta.rows_read,
            })
          return results
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { env: { ...bindings, DB }, costs }
}
