import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { VenueSummary } from '@noqueue/contracts/staff'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, errorMessage } from './api'
import { Dashboard } from './Dashboard'

export function CommercialEstablishment({
  venueId,
  returnPage,
}: {
  venueId: string
  returnPage: unknown
}) {
  const [venue, setVenue] = useState<Omit<VenueSummary, 'role'> | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const back =
    typeof returnPage === 'number' &&
    Number.isSafeInteger(returnPage) &&
    returnPage > 1 &&
    returnPage <= Math.floor(Number.MAX_SAFE_INTEGER / 24)
      ? `/staff?page=${returnPage}`
      : '/staff'
  useEffect(() => {
    let live = true
    api<Omit<VenueSummary, 'role'>>(
      `/commercial/venues/${encodeURIComponent(venueId)}`,
    )
      .then((data) => {
        if (live) setVenue(data)
      })
      .catch((cause) => {
        if (live) setError(errorMessage(cause))
      })
    return () => {
      live = false
    }
  }, [venueId, attempt])
  return (
    <>
      <Button
        variant="outline"
        nativeButton={false}
        role="link"
        render={<Link to={back} />}
      >
        <ArrowLeft />
        Volver a establecimientos
      </Button>
      {error ? (
        <div className="space-y-3">
          <p role="alert">{error}</p>
          <Button
            variant="outline"
            onClick={() => {
              setError('')
              setVenue(null)
              setAttempt((value) => value + 1)
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : venue ? (
        <Dashboard key={venue.id} venue={venue} mode="commercial" />
      ) : (
        <p role="status">Cargando establecimiento…</p>
      )}
    </>
  )
}
