// SQL (which can contain a credential hash) stays in memory and in the HTTPS body,
// never in argv, a temporary file, or a CLI diagnostic log.
export function productionD1({ accountId, databaseId, token, request = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(accountId) || !/^[a-f0-9-]{36}$/.test(databaseId) || !token)
    throw new Error('Explicit D1 identity and credential required')
  return async (sql) => {
    let response, body
    try {
      response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }), signal: AbortSignal.timeout(30000),
      })
      body = await response.json()
    } catch { throw new Error('D1 request failed; details withheld; verify outcome before retrying') }
    if (!response.ok || body.success !== true || !Array.isArray(body.result) ||
        body.result.some((result) => result.success !== true || !Array.isArray(result.results)))
      throw new Error('D1 query failed; private provider diagnostics withheld')
    return body.result
  }
}
