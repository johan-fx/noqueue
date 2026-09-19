import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { VenueSummary } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { authClient } from '@/data/auth/client'
import { api, ApiError, errorMessage } from './api'
import { Choice } from './ServiceForm'
import { Commercial } from './Commercial'
import { Dashboard } from './Dashboard'
type Me = {
  user: { id: string; email: string; username: string }
  commercial: boolean
  venues: VenueSummary[]
}
export function StaffApp() {
  const [me, setMe] = useState<Me | null>(null),
    [venueId, setVenueId] = useState(''),
    [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    api<Me>('/me')
      .then((data) => {
        setMe(data)
        setVenueId(data.venues[0]?.id ?? '')
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/login')
        else setError(errorMessage(e))
      })
  }, [navigate])
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4">
          <Link to="/staff" className="text-xl font-semibold tracking-tight">
            NoQueue
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/settings/account">Ajustes</Link>
            <span className="hidden text-sm text-muted-foreground sm:block">
              {me?.user.username}
            </span>
            <Button
              variant="outline"
              onClick={async () => {
                await authClient.signOut()
                navigate('/login')
              }}
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!me && !error && <p role="status">Comprobando acceso…</p>}
        {me?.commercial && <Commercial />}
        {!!me?.venues.length && (
          <>
            <div className="max-w-sm">
              <Choice
                label="Establecimiento"
                value={venueId}
                items={Object.fromEntries(me.venues.map((v) => [v.id, v.name]))}
                onChange={setVenueId}
              />
            </div>
            {me.venues.find((v) => v.id === venueId) && (
              <Dashboard
                key={venueId}
                venue={me.venues.find((v) => v.id === venueId)!}
              />
            )}
          </>
        )}
        {me && !me.commercial && !me.venues.length && (
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
