import { useEffect } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { RouterProvider } from 'react-router'
import { createAppRouter } from '@/app/bootstrap/create-app-router'
import { detectRuntime } from '@/app/bootstrap/runtime'
import { registerDeepLinkListener } from '@/platform/capacitor/deep-links'
import { customerRouteFromUrl } from '@/platform/capacitor/deep-link-routing'

const runtime = detectRuntime()
const router = createAppRouter(runtime)

export default function App() {
  useEffect(() => {
    if (runtime !== 'native') return
    let live = true
    let removeListener: (() => Promise<void>) | undefined
    const openCustomerRoute = (url: URL) => {
      const route = customerRouteFromUrl(
        url.href,
        import.meta.env.VITE_PUBLIC_APP_ORIGIN,
      )
      if (live && route) void router.navigate(route)
    }
    void (async () => {
      removeListener = await registerDeepLinkListener(openCustomerRoute)
      const launch = await CapacitorApp.getLaunchUrl()
      if (launch?.url) openCustomerRoute(new URL(launch.url))
    })().catch(() => undefined)
    return () => {
      live = false
      if (removeListener) void removeListener()
    }
  }, [])

  return <RouterProvider router={router} />
}
