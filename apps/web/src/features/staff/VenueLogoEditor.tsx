import { useCallback, useRef, useState } from 'react'
import { ImageIcon, Pencil } from 'lucide-react'
import type { VenueLogoState } from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiError, errorMessage } from './api'
import { deleteVenueLogo, getVenueLogo, putVenueLogo } from './logo-api'
import { VenueLogoUpload } from './VenueLogoUpload'

type LogoIntent = {
  kind: 'upload' | 'delete'
  version: number
  file: File | null
  key: string
}

export function VenueLogoEditor({
  venueId,
  venueName,
  state,
  onStateChange,
}: {
  venueId: string
  venueName: string
  state: VenueLogoState
  onStateChange: (next: VenueLogoState) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftFile, setDraftFile] = useState<File | null>(null)
  const [changed, setChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uploaderRevision, setUploaderRevision] = useState(0)
  const intent = useRef<LogoIntent | null>(null)
  const busyRef = useRef(false)

  const resetDraft = useCallback(() => {
    setDraftFile(null)
    setChanged(false)
    setError('')
    intent.current = null
    setUploaderRevision((revision) => revision + 1)
  }, [])

  function handleOpenChange(next: boolean) {
    if (busyRef.current) return
    resetDraft()
    setOpen(next)
  }

  const handleFileChange = useCallback((file: File) => {
    setDraftFile(file)
    setChanged(true)
    setError('')
    intent.current = null
  }, [])

  const handleRemove = useCallback(() => {
    setDraftFile(null)
    setChanged(true)
    setError('')
    intent.current = null
  }, [])

  const handleInvalidFile = useCallback((validationMessage: string) => {
    setDraftFile(null)
    setChanged(false)
    setError(validationMessage)
    intent.current = null
    // ReUI clears the old item before validating a replacement. Re-mounting
    // restores the persisted logo so an invalid choice can never stage deletion.
    setUploaderRevision((revision) => revision + 1)
  }, [])

  async function save() {
    if (!changed || busyRef.current) return
    if (!draftFile && !state.logo) {
      handleOpenChange(false)
      return
    }
    const kind: LogoIntent['kind'] = draftFile ? 'upload' : 'delete'
    const prior = intent.current
    const request =
      prior &&
      prior.kind === kind &&
      prior.version === state.logoVersion &&
      prior.file === draftFile
        ? prior
        : {
            kind,
            version: state.logoVersion,
            file: draftFile,
            key: crypto.randomUUID(),
          }
    intent.current = request
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next =
        request.kind === 'upload' && request.file
          ? await putVenueLogo(
              venueId,
              request.file,
              request.version,
              request.key,
            )
          : await deleteVenueLogo(venueId, request.version, request.key)
      onStateChange(next)
      setOpen(false)
      resetDraft()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'logo_version_conflict') {
        try {
          const current = await getVenueLogo(venueId)
          onStateChange(current)
        } catch {
          // Preserve the conflict message even if the follow-up read also fails.
        }
        setDraftFile(null)
        setChanged(false)
        intent.current = null
        setUploaderRevision((revision) => revision + 1)
        setError(
          'El logotipo cambió mientras lo editabas. Se ha actualizado el estado actual; revisa y vuelve a seleccionar el archivo si quieres cambiarlo.',
        )
      } else {
        // Keep the same intent key and file so an uncertain retry is replay-safe.
        setError(errorMessage(cause))
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const canSave = changed && (!!draftFile || !!state.logo) && !busy
  return (
    <div className="group relative flex size-12 shrink-0 items-center justify-center">
      {state.logo ? (
        <img
          key={`${state.logo.url}:${state.logoVersion}`}
          src={state.logo.url}
          alt={`Logotipo de ${venueName}`}
          className="size-12 rounded-lg border bg-background object-contain p-1"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground"
        >
          <ImageIcon className="size-5" />
        </div>
      )}
      {state.canEditLogo && (
        <>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={`Editar logotipo de ${venueName}`}
            className="absolute -right-2 -bottom-2 z-10 size-7 rounded-full border shadow-sm opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
            onClick={() => handleOpenChange(true)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Editar logotipo de {venueName}</DialogTitle>
                <DialogDescription>
                  El cambio solo se guardará cuando confirmes. Puedes subir PNG,
                  JPG o SVG de hasta 5 MB.
                </DialogDescription>
              </DialogHeader>
              <VenueLogoUpload
                key={`${venueId}:${state.logoVersion}:${uploaderRevision}`}
                logo={state.logo}
                disabled={busy}
                busy={busy}
                error={error}
                onFileChange={handleFileChange}
                onRemove={handleRemove}
                onInvalidFile={handleInvalidFile}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button type="button" disabled={!canSave} onClick={() => void save()}>
                  {busy ? 'Guardando…' : 'Guardar'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
