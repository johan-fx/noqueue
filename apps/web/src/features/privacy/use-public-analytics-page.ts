import { useEffect } from 'react'
import { useLocation } from 'react-router'

/** Initial API failures must not be counted as venue/queue page visits. No business data leaves this hook. */
export function usePublicAnalyticsPage(ready: boolean, failed = false) {
  const { pathname } = useLocation()
  useEffect(() => {
    if (ready || failed) window.dispatchEvent(new CustomEvent('noqueue:public-page-ready', {
      detail: { pathname, ready: ready && !failed },
    }))
  }, [pathname, ready, failed])
}
