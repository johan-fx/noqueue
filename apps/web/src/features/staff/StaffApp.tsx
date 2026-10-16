import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useLocation } from 'react-router'
import type { VenueLogoState, VenueSummary } from '@noqueue/contracts/staff'
import { LogOut, Settings, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { authClient } from '@/data/auth/client'
import { api, ApiError, errorMessage } from './api'
import { Choice } from './ServiceForm'
import { Commercial } from './Commercial'
import { VenueDashboard } from './VenueDashboard'
import { CommercialEstablishment } from './CommercialEstablishment'
type Me = {
  user: { id: string; email: string; username: string }
  platformAdmin: boolean
  commercial: boolean
  features?: { venueLogos?: boolean; metrics?: boolean }
  venues: VenueSummary[]
}
export function StaffApp() {
  const [me, setMe] = useState<Me | null>(null),
    [venueId, setVenueId] = useState(''),
    [error, setError] = useState(''),
    [accessAttempt, setAccessAttempt] = useState(0)
  const navigate = useNavigate()
  const { venueId: detailId } = useParams()
  const location = useLocation()
  function updateVenueLogo(venueId: string, state: VenueLogoState) {
    setMe((current) =>
      current
        ? {
            ...current,
            venues: current.venues.map((venue) =>
              venue.id === venueId ? { ...venue, ...state } : venue,
            ),
          }
        : current,
    )
  }
  useEffect(() => {
    const controller = new AbortController()
    // A stalled connection is not an expired session. Keep credentials intact
    // and allow a new read; never retry a mutation or accept a late response.
    const timeout = window.setTimeout(() => {
      controller.abort()
      setError('La comprobación de acceso está tardando demasiado. Puedes reintentar sin cerrar sesión.')
    }, 15_000)
    api<Me>('/me', 'GET', undefined, undefined, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setMe(data)
        setVenueId(data.venues[0]?.id ?? '')
      })
      .catch((e) => {
        if (controller.signal.aborted) return
        if (e instanceof ApiError && e.status === 401) navigate('/login')
        else setError(e instanceof TypeError
          ? 'No se ha podido conectar para comprobar tu acceso. Reintenta sin cerrar sesión.'
          : errorMessage(e))
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [navigate, accessAttempt])
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <Link to="/staff" className="text-xl font-semibold tracking-tight">
            NoQueue
          </Link>
          {/* Account menu: settings icon opens Ajustes + sign out. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" />}
            >
              <Settings />
              <span className="sr-only">Ajustes</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{me?.user.username}</DropdownMenuLabel>
                <DropdownMenuItem render={<Link to="/settings/account" />}>
                  <User />
                  Ajustes
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  await authClient.signOut()
                  navigate('/login')
                }}
              >
                <LogOut />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => {
              setError('')
              setAccessAttempt((attempt) => attempt + 1)
            }}>
              Reintentar acceso
            </Button>
          </div>
        )}
        {!me && !error && <p role="status">Comprobando acceso…</p>}
        {me &&
          detailId &&
          (me.commercial ? (
            <CommercialEstablishment
              key={detailId}
              venueId={detailId}
              returnPage={location.state?.returnPage}
              returnSearch={location.state?.returnSearch}
            />
          ) : (
            <p role="alert">No tienes acceso a este establecimiento.</p>
          ))}
        {me?.commercial && !detailId && (
          <Commercial logoUploadEnabled={me.features?.venueLogos === true} metricsEnabled={me.features?.metrics === true} />
        )}
        {!detailId && !!me?.venues.length && (
          <>
            {me.venues.length > 1 && (
              <div className="max-w-sm">
                <Choice
                  label="Establecimiento"
                  value={venueId}
                  items={Object.fromEntries(
                    me.venues.map((v) => [v.id, v.name]),
                  )}
                  onChange={setVenueId}
                />
              </div>
            )}
            {/* Mixed-role accounts keep their existing management, but only portfolio tabs. */}
            {me.venues.find((v) => v.id === venueId) && (
              <VenueDashboard
                metricsEnabled={!me.commercial && me.features?.metrics === true}
                key={venueId}
                venue={me.venues.find((v) => v.id === venueId)!}
                onVenueLogoStateChange={(state) =>
                  updateVenueLogo(venueId, state)
                }
              />
            )}
          </>
        )}
        {me && !detailId && !me.commercial && !me.venues.length && (
          <Card>
            <CardContent className="py-8">
              No tienes establecimientos asignados. Contacta con el
              administrador o con tu asesor de NoQueue.
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
