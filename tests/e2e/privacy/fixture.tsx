// Uses the real production privacy controller, router barrier and notice restoration.
// Only the product screens and Google/API network are replaced with deterministic fakes.
import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Link, RouterProvider, useLocation, useNavigate } from 'react-router'
import { attachPrivacyRouter, privacy } from '../../../apps/web/src/features/privacy/runtime'
import '../../../packages/privacy/src/styles.css'
import { usePublicAnalyticsPage } from '../../../apps/web/src/features/privacy/use-public-analytics-page'
function Screen() {
  const navigate = useNavigate(), location = useLocation()
  usePublicAnalyticsPage(location.pathname !== '/q/missing', location.pathname === '/q/missing')
  return <main>
    <h1>{location.pathname.startsWith('/t/') ? 'Ticket' : 'Public'}</h1>
    {location.state?.joined && <p>Turn created</p>}
    <Link to="/search?search=PRIVATE-SEARCH&lang=en#PRIVATE-HASH">Search</Link>
    <Link to="/q/example-queue">Queue</Link>
    <Link to="/">Home</Link>
    <button onClick={() => navigate('/t/' + 'a'.repeat(64) + '?notice=PRIVATE-NOTICE&lang=en', { state: { joined: true } })}>Join</button>
    <button onClick={() => privacy.show()}>Privacy</button>
  </main>
}
const router = createBrowserRouter([{ path: '*', Component: Screen }])
attachPrivacyRouter(router)
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>)
