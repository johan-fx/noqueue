/** Conservative D1 budget: every SQL statement in a batch counts, not just the
 * network round trip. Leave at least 100 of the Paid plan's 1,000 queries for
 * scheduled housekeeping/dispatch, and reserve lease releases inside this limit. */
export class MetricsBudgetExceeded extends Error {
  constructor() {
    super('metrics_query_budget_exhausted')
  }
}

export function metricsQueryLimit(env: CloudflareBindings) {
  const configured = Number(env.METRICS_D1_QUERY_BUDGET ?? 800)
  return Number.isInteger(configured) && configured >= 64 && configured <= 900
    ? configured
    : 800
}

export function createMetricsBudget(source: D1Database, limit = 800) {
  let used = 0
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>()
  const charge = (count: number) => {
    if (used + count > limit - 32) throw new MetricsBudgetExceeded()
    used += count
  }
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === 'bind')
          return (...values: unknown[]) => wrap(target.bind(...values))
        if (['all', 'first', 'run', 'raw'].includes(String(key)))
          return (...args: unknown[]) => {
            charge(1)
            return Reflect.get(target, key).apply(target, args)
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    statements.set(wrapped, statement)
    return wrapped
  }
  const db = new Proxy(source, {
    get(target, key) {
      if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql))
      if (key === 'batch')
        return (batch: D1PreparedStatement[]) => {
          charge(batch.length) // Charge before submitting: never interrupt a transaction.
          return target.batch(batch.map((s) => statements.get(s) ?? s))
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return {
    db,
    limit,
    get used() {
      return used
    },
    async releaseLease(token: string) {
      if (++used > limit) throw new MetricsBudgetExceeded()
      await source
        .prepare(
          'UPDATE metrics_control SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?',
        )
        .bind(token)
        .run()
    },
  }
}
export type MetricsBudget = ReturnType<typeof createMetricsBudget>
