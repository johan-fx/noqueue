import { useCallback, useId, useMemo } from 'react'
import { FileImage, LoaderCircle, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { VenueLogo } from '@noqueue/contracts/staff'
import {
  formatBytes,
  useFileUpload,
  type FileMetadata,
  type FileWithPreview,
} from '@/hooks/use-file-upload'

const MAX_LOGO_BYTES = 5 * 1024 * 1024
const ACCEPTED_LOGO_TYPES =
  'image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg'

function asBrowserFile(file: File | FileMetadata): file is File {
  return typeof File !== 'undefined' && file instanceof File
}

function displayFileSize(bytes: number) {
  return formatBytes(bytes, 1).replace(/(Bytes|KB|MB|GB)$/, ' $1').replace('Bytes', 'B')
}

function translatedValidationError(errors: string[]) {
  if (!errors.length) return ''
  if (errors.some((error) => /size|maximum/i.test(error)))
    return 'El archivo supera el tamaño máximo de 5 MB.'
  return 'Selecciona un archivo PNG, JPG o SVG válido.'
}

export function VenueLogoUpload({
  logo = null,
  disabled = false,
  busy = false,
  error = '',
  onFileChange,
  onRemove,
  onInvalidFile,
  label = 'Logotipo',
  optional = false,
}: {
  logo?: VenueLogo | null
  disabled?: boolean
  busy?: boolean
  error?: string
  onFileChange?: (file: File) => void
  onRemove?: () => void
  onInvalidFile?: (message: string) => void
  label?: string
  optional?: boolean
}) {
  const inputId = useId()
  const helpId = `${inputId}-help`
  const initialFiles = useMemo<FileMetadata[]>(
    () =>
      logo
        ? [
            {
              id: `venue-logo-${logo.url}`,
              name: logo.name,
              size: logo.size,
              type: logo.type,
              url: logo.url,
            },
          ]
        : [],
    [logo],
  )
  const handleFilesAdded = useCallback(
    (files: FileWithPreview[]) => {
      const selected = files.find((item) => asBrowserFile(item.file))?.file
      if (selected && asBrowserFile(selected)) onFileChange?.(selected)
    },
    [onFileChange],
  )
  const handleInvalidFile = useCallback(
    (errors: string[]) => onInvalidFile?.(translatedValidationError(errors)),
    [onInvalidFile],
  )
  const [state, actions] = useFileUpload({
    accept: ACCEPTED_LOGO_TYPES,
    initialFiles,
    maxFiles: 1,
    maxSize: MAX_LOGO_BYTES,
    multiple: false,
    onFilesAdded: handleFilesAdded,
    onError: handleInvalidFile,
  })
  const selected = state.files[0]
  const file = selected?.file
  const preview = selected?.preview
  const fileName = file?.name
  const fileSize = file?.size
  const validationError = translatedValidationError(state.errors)
  const visibleError = error || validationError
  const isBusy = disabled || busy

  return (
    <div className="flex flex-col items-start gap-2 pt-4" data-component="venue-logo-upload">
      <label className="text-sm font-medium leading-5" htmlFor={inputId}>
        {label}
        {optional && (
          <span className="ml-1 font-normal text-muted-foreground">· opcional</span>
        )}
      </label>
      <input
        {...actions.getInputProps({
          id: inputId,
          className: 'sr-only',
          'aria-label': 'Archivo de logotipo',
          disabled: isBusy,
        })}
      />

      {selected ? (
        <div className="flex w-full flex-col gap-2 rounded-md border bg-background px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
              {preview ? (
                <img
                  src={preview}
                  alt="Previsualización del logotipo"
                  className="size-full object-contain p-1"
                />
              ) : (
                <FileImage aria-hidden="true" className="size-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1 text-sm leading-5">
              <p className="truncate font-medium" title={fileName}>
                {fileName}
              </p>
              <p className="text-muted-foreground">
                {fileSize == null ? '' : displayFileSize(fileSize)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy}
              onClick={actions.openFileDialog}
            >
              Cambiar
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy}
              onClick={() => {
                actions.clearFiles()
                onRemove?.()
              }}
            >
              Eliminar
            </Button>
          </div>
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              Subiendo logotipo…
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={isBusy}
          aria-label="Subir logotipo"
          aria-describedby={helpId}
          aria-busy={busy}
          onClick={actions.openFileDialog}
          onDragEnter={actions.handleDragEnter}
          onDragLeave={actions.handleDragLeave}
          onDragOver={actions.handleDragOver}
          onDrop={actions.handleDrop}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            visibleError
              ? 'border-red-300 text-red-600'
              : state.isDragging
                ? 'border-foreground text-foreground'
                : 'border-input hover:border-foreground'
          }`}
        >
          <span className="flex size-8 items-center justify-center rounded bg-muted p-2 text-muted-foreground">
            <Upload aria-hidden="true" className="size-4" />
          </span>
          <span className="flex items-center gap-2 text-sm font-medium">
            {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
            {busy ? 'Subiendo logotipo…' : 'Subir logotipo'}
          </span>
          <span id={helpId} className="text-sm text-muted-foreground">
            PNG, JPG o SVG · Máx. 5 MB · PNG/JPG hasta 8 MP
          </span>
        </button>
      )}

      {visibleError && (
        <p role="alert" className="text-sm text-destructive">
          {visibleError}
        </p>
      )}
    </div>
  )
}
