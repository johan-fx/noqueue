import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router'
import type { VenueLogoState, VenueSummary } from '@noqueue/contracts/staff'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dashboard } from './Dashboard'

const LazyMetrics = lazy(() => import('./CommercialMetrics').then((module) => ({ default: module.MetricsDashboard })))

export function VenueDashboard({ venue, metricsEnabled, onVenueLogoStateChange }: {
  venue: VenueSummary
  metricsEnabled: boolean
  onVenueLogoStateChange: (state: VenueLogoState) => void
}) {
  const [search, setSearch] = useSearchParams()
  const allowed = metricsEnabled && venue.canReadMetrics === true &&
    (venue.role === 'owner' || venue.role === 'venue_manager') && !!venue.timezone
  const tab = allowed && search.get('tab') === 'metrics' ? 'metrics' : 'management'
  const management = <Dashboard venue={venue} onVenueLogoStateChange={onVenueLogoStateChange} />
  if (!allowed) return management

  return (
    <Tabs value={tab} className="gap-6" onValueChange={(value) => {
      const next = new URLSearchParams(search)
      next.set('tab', String(value))
      setSearch(next, { replace: true })
    }}>
      <TabsList variant="line" aria-label="Vista del establecimiento" className="w-full justify-start gap-6 border-b">
        <TabsTrigger value="management" className="flex-none">Gestión</TabsTrigger>
        <TabsTrigger value="metrics" className="flex-none">Métricas</TabsTrigger>
      </TabsList>
      <TabsContent value="management">
        {/* Unmount operational polling and drawers while analytics are active. */}
        {tab === 'management' && management}
      </TabsContent>
      <TabsContent value="metrics">
        {tab === 'metrics' && (
          <Suspense fallback={<p role="status">Cargando panel de métricas…</p>}>
            <LazyMetrics venue={{ id: venue.id, name: venue.name, timezone: venue.timezone! }} />
          </Suspense>
        )}
      </TabsContent>
    </Tabs>
  )
}
