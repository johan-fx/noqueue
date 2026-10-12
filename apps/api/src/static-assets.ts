type FetcherFunction = (request: Request) => Response | Promise<Response>

/**
 * Route Worker-first asset requests through the ASSETS binding and prevent its
 * SPA fallback from disguising a missing /assets file as a successful HTML
 * response. Other requests remain owned by the application handler.
 */
export async function handleWorkerRequest(
  request: Request,
  fetchAsset: FetcherFunction,
  fetchApplication: FetcherFunction,
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith('/assets/')) return fetchApplication(request)

  const response = await fetchAsset(request)
  const contentType = response.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()

  // With not_found_handling=single-page-application, an absent asset is
  // returned as index.html (often with status 200). Assets must never resolve
  // to HTML: browsers reject that response as a JavaScript module.
  if (!response.ok || contentType !== 'text/html') return response

  return new Response(request.method === 'HEAD' ? null : 'Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
