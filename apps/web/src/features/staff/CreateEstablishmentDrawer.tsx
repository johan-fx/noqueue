import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  provisionSchema,
  type ProvisionInput,
  type ServiceInput,
} from '@noqueue/contracts/staff'
import { Eye, EyeOff, Plus } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { ServiceConfigDrawer } from './ServiceConfigDrawer'

const clientSchema = provisionSchema.omit({ services: true })
export type ClientInput = Omit<ProvisionInput, 'services'>

const defaults: ClientInput = {
  organizationName: '',
  slug: '',
  venueName: '',
  // Solo España por ahora: no pedimos la zona al comercial.
  timezone: 'Europe/Madrid',
  ownerName: '',
  ownerUsername: '',
  ownerPassword: '',
}

// Identificador interno: minúsculas, guiones y un sufijo para que no choque.
function slugFrom(value: string) {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
  return `${base || 'hotel'}-${suffix}`.slice(0, 60)
}

const fields = [
  ['organizationName', 'Empresa / organización'],
  ['venueName', 'Hotel / establecimiento'],
  ['ownerName', 'Nombre del administrador'],
  ['ownerUsername', 'Usuario del administrador'],
] as const

const passwordLabel = 'Contraseña inicial (mínimo 15 caracteres)'
const confirmLabel = 'Confirmar contraseña'

export function CreateEstablishmentDrawer({
  open,
  saving = false,
  error = '',
  onOpenChange,
  onComplete,
}: {
  open: boolean
  saving?: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onComplete: (client: ClientInput, service: ServiceInput) => void | Promise<void>
}) {
  const [configOpen, setConfigOpen] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const prefix = useId()
  const formId = `${prefix}-client`
  const form = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: defaults,
  })

  // The parent can close the alta after a successful save without using this handler.
  if (!open && configOpen) setConfigOpen(false)

  function changeOpen(next: boolean) {
    if (saving) return
    if (next) {
      form.reset(defaults)
      setConfirmPassword('')
      setConfirmError('')
      setShowPassword(false)
      setShowConfirm(false)
      setConfigOpen(false)
      setResetKey((value) => value + 1)
    }
    onOpenChange(next)
  }

  return (
    <Drawer open={open} onOpenChange={changeOpen} swipeDirection="right">
      <DrawerTrigger render={<Button />}>
        <Plus aria-hidden="true" />
        Crear nuevo
      </DrawerTrigger>
      <DrawerContent className="w-full sm:w-md">
        <DrawerHeader className="border-b p-6">
          <DrawerTitle className="text-xl">Cliente y administrador</DrawerTitle>
          <DrawerDescription>
            Introduce los datos del cliente y su primer acceso. El alta se
            guardará al confirmar la configuración del primer servicio.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          <form
            id={formId}
            className="space-y-4"
            onSubmit={(event) => {
              // El comercial no ve el identificador; lo rellenamos antes de validar.
              if (!form.getValues('slug')) {
                form.setValue(
                  'slug',
                  slugFrom(
                    form.getValues('venueName') ||
                      form.getValues('organizationName'),
                  ),
                )
              }
              const matches =
                form.getValues('ownerPassword') === confirmPassword
              setConfirmError(matches ? '' : 'Las contraseñas no coinciden')
              void form.handleSubmit(() => {
                if (matches) setConfigOpen(true)
              })(event)
            }}
          >
            {fields.map(([name, label]) => (
              <Field key={name}>
                <FieldLabel htmlFor={`${prefix}-${name}`}>{label}</FieldLabel>
                <Input
                  id={`${prefix}-${name}`}
                  autoComplete={name === 'ownerPassword' ? 'new-password' : 'off'}
                  type={name === 'ownerPassword' ? 'password' : 'text'}
                  {...form.register(name)}
                  aria-invalid={!!form.formState.errors[name]}
                />
                <FieldError errors={[form.formState.errors[name]]} />
              </Field>
            ))}
            <PasswordField
              id={`${prefix}-ownerPassword`}
              label={passwordLabel}
              visible={showPassword}
              value={form.watch('ownerPassword')}
              error={form.formState.errors.ownerPassword?.message}
              autoComplete="new-password"
              onToggle={() => setShowPassword((value) => !value)}
              onChange={(value) => {
                form.setValue('ownerPassword', value, {
                  shouldDirty: true,
                  shouldValidate: form.formState.isSubmitted,
                })
                if (confirmError) setConfirmError('')
              }}
            />
            <PasswordField
              id={`${prefix}-ownerPasswordConfirm`}
              label={confirmLabel}
              visible={showConfirm}
              value={confirmPassword}
              error={confirmError}
              autoComplete="new-password"
              onToggle={() => setShowConfirm((value) => !value)}
              onChange={(value) => {
                setConfirmPassword(value)
                if (confirmError) setConfirmError('')
              }}
            />
          </form>
        </div>
        <DrawerFooter className="border-t bg-background p-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            size="lg"
            variant="ghost"
            disabled={saving}
            onClick={() => changeOpen(false)}
          >
            Cancelar
          </Button>
          <Button type="submit" size="lg" form={formId} disabled={saving}>
            Continuar
          </Button>
        </DrawerFooter>
        {/* Nested like "Añadir espacio": this root sits inside the parent popup. */}
        <ServiceConfigDrawer
          open={configOpen}
          mode="create"
          saving={saving}
          error={error}
          resetKey={String(resetKey)}
          onClose={() => {
            if (!saving) setConfigOpen(false)
          }}
          onSave={(service) => onComplete(form.getValues(), service)}
        />
      </DrawerContent>
    </Drawer>
  )
}

function PasswordField({
  id,
  label,
  visible,
  value,
  error,
  autoComplete,
  onToggle,
  onChange,
}: {
  id: string
  label: string
  visible: boolean
  value: string
  error?: string
  autoComplete: string
  onToggle: () => void
  onChange: (value: string) => void
}) {
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          autoComplete={autoComplete}
          type={visible ? 'text' : 'password'}
          className="pr-11"
          value={value}
          aria-invalid={!!error}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          onClick={onToggle}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      <FieldError errors={error ? [{ message: error }] : []} />
    </Field>
  )
}
