import { useEffect, useState } from 'react'
import type { VenueLocationSnapshot } from '@noqueue/contracts/discovery'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LocationPicker } from './LocationPicker'
import { api, errorMessage, ApiError } from './api'
export function VenueLocationEditor({
  venueId,
  canEditLocation,
}: {
  venueId: string
  canEditLocation: boolean
}) {
  const [snapshot, setSnapshot] = useState<VenueLocationSnapshot | null>(null)
  const [editing, setEditing] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  useEffect(() => {
    let live = true
    api<VenueLocationSnapshot>(`/venues/${venueId}/location`)
      .then((data) => {
        if (live) setSnapshot(data)
      })
      .catch((e) => {
        if (live) setError(errorMessage(e))
      })
    return () => {
      live = false
    }
  }, [venueId])
  async function save() {
    if (!canEditLocation || !snapshot || !token || busy || conflict) return
    setBusy(true)
    setError('')
    try {
      setSnapshot(
        await api<VenueLocationSnapshot>(`/venues/${venueId}`, 'PATCH', {
          version: snapshot.version,
          locationToken: token,
        }),
      )
      setEditing(false)
      setToken('')
    } catch (e) {
      setError(errorMessage(e))
      setConflict(e instanceof ApiError && e.status === 409)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ubicación del establecimiento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          {snapshot?.location?.formatted ??
            (canEditLocation
              ? 'Completa la ubicación para mostrar tus servicios en la búsqueda pública.'
              : 'Ubicación pendiente de confirmación por administración.')}
        </p>
        {snapshot?.location && (
          <p className="text-xs text-muted-foreground">
            {snapshot.location.attribution.map((a, i) => (
              <span key={a.url}>
                {i ? ' · ' : ''}
                <a href={a.url} target="_blank" rel="noreferrer">
                  {a.text}
                </a>
              </span>
            ))}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {canEditLocation && snapshot && !editing && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing(true)
              setError('')
              setConflict(false)
            }}
          >
            Editar ubicación
          </Button>
        )}
        {canEditLocation && editing && snapshot && (
          <>
            <LocationPicker
              scope={{ kind: 'venue', id: venueId }}
              initialAddress={snapshot.location?.formatted ?? ''}
              disabled={busy}
              onSelection={setToken}
            />
            {conflict && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  try {
                    setSnapshot(
                      await api<VenueLocationSnapshot>(
                        `/venues/${venueId}/location`,
                      ),
                    )
                    setConflict(false)
                    setError(
                      'Datos actualizados. Revisa la dirección seleccionada y confirma de nuevo.',
                    )
                  } catch (e) {
                    setError(errorMessage(e))
                  }
                }}
              >
                Actualizar versión
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!token || busy || conflict}
                onClick={() => void save()}
              >
                {busy ? 'Guardando…' : 'Guardar ubicación'}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setToken('')
                  setError('')
                }}
              >
                Cancelar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
