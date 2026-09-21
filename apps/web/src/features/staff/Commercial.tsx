import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  provisionSchema,
  type ProvisionInput,
  type ServiceInput,
} from '@noqueue/contracts/staff'
import { Plus } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from '@/components/ui/card'
import {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { ServiceForm } from './ServiceForm'
import { Members } from './Members'
import { api, errorMessage } from './api'
type Customer = {
  id: string
  name: string
  slug: string
  status: string
  venueId: string
  venueName: string
}
const clientSchema = provisionSchema.omit({ services: true })
type ClientInput = Omit<ProvisionInput, 'services'>
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
export function Commercial() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [draftId, setDraftId] = useState(0)
  const [open, setOpen] = useState(false),
    [step, setStep] = useState<1 | 2>(1)
  const [saveError, setSaveError] = useState(''),
    [saving, setSaving] = useState(false)
  const pending = useRef(false),
    requestKey = useRef(crypto.randomUUID()),
    fingerprint = useRef('')
  const prefix = useId(),
    clientFormId = `${prefix}-client`,
    serviceFormId = `${prefix}-service`
  const titleRef = useRef<HTMLHeadingElement>(null)
  const accessTriggerRef = useRef<HTMLButtonElement | null>(null)
  const form = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: defaults,
  })
  useEffect(() => {
    let active = true
    api<Customer[]>('/commercial/organizations')
      .then((data) => {
        if (active) setCustomers(data)
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (open && step === 2) titleRef.current?.focus()
  }, [open, step])
  async function refresh() {
    setLoading(true)
    setError('')
    try {
      setCustomers(await api<Customer[]>('/commercial/organizations'))
    } catch (e) {
      setError(`No se pudo actualizar el listado. ${errorMessage(e)}`)
    } finally {
      setLoading(false)
    }
  }
  function changeOpen(next: boolean) {
    if (pending.current) return
    setOpen(next)
    if (next) {
      setMessage('')
      setDraftId((value) => value + 1)
      setStep(1)
    }
    form.reset(defaults)
    setSaveError('')
    fingerprint.current = ''
    requestKey.current = crypto.randomUUID()
  }
  async function complete(service: ServiceInput) {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setSaveError('')
    const input = { ...form.getValues(), services: [service] }
    const next = JSON.stringify(input)
    if (fingerprint.current !== next) {
      requestKey.current = crypto.randomUUID()
      fingerprint.current = next
    }
    try {
      await api('/commercial/organizations', 'POST', input, requestKey.current)
      setOpen(false)
      form.reset(defaults)
      fingerprint.current = ''
      setMessage(
        'Establecimiento creado. Entrega las credenciales al administrador por un canal seguro. El servicio se ha creado cerrado.',
      )
      await refresh()
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <div className="space-y-6">
      {message && <p role="status">{message}</p>}
      <Drawer open={open} onOpenChange={changeOpen} swipeDirection="right">
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold">Establecimientos</h1>
            </CardTitle>
            <CardDescription>
              Gestiona tus clientes y sus accesos a NoQueue.
            </CardDescription>
            <CardAction>
              <DrawerTrigger render={<Button />}>
                <Plus aria-hidden="true" />
                Crear nuevo
              </DrawerTrigger>
            </CardAction>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 space-y-2">
                <p role="alert" className="text-destructive">
                  {error}
                </p>
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  Actualizar listado
                </Button>
              </div>
            )}
            <Table aria-label="Listado de establecimientos" aria-busy={loading}>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Establecimiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Accesos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!customers.length && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {loading
                        ? 'Cargando establecimientos…'
                        : error
                          ? 'Listado no disponible.'
                          : 'Todavía no hay establecimientos. Crea el primero para empezar.'}
                    </TableCell>
                  </TableRow>
                )}
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>{customer.name}</TableCell>
                    <TableCell>{customer.venueName}</TableCell>
                    <TableCell>
                      {customer.status === 'active' ? 'Activo' : 'Suspendido'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        onClick={(event) => {
                          accessTriggerRef.current = event.currentTarget
                          setSelected(customer)
                        }}
                      >
                        Gestionar accesos
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <DrawerContent className="w-full sm:w-[36rem] sm:max-w-[calc(100vw-2rem)]">
          <DrawerHeader className="border-b p-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Nuevo establecimiento · Paso {step} de 2
            </p>
            <DrawerTitle
              ref={titleRef}
              tabIndex={-1}
              className="text-xl outline-none"
            >
              {step === 1
                ? '1. Cliente y administrador'
                : '2. Configuración de servicios'}
            </DrawerTitle>
            <DrawerDescription>
              {step === 1
                ? 'Introduce los datos del cliente y su primer acceso. El alta se guardará al finalizar la configuración del servicio.'
                : `Configura el primer servicio de ${form.getValues('venueName')}. Se creará cerrado para que puedas revisarlo antes de abrirlo.`}
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
            {saveError && (
              <p role="alert" className="mb-4 text-destructive">
                {saveError}
              </p>
            )}
            <div hidden={step !== 1}>
              <form
                id={clientFormId}
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
                  void form.handleSubmit(() => {
                    setSaveError('')
                    setStep(2)
                  })(event)
                }}
                className="space-y-4"
              >
                {(
                  [
                    ['organizationName', 'Empresa / organización'],
                    ['venueName', 'Hotel / establecimiento'],
                    ['ownerName', 'Nombre del administrador'],
                    ['ownerUsername', 'Usuario del administrador'],
                    [
                      'ownerPassword',
                      'Contraseña inicial (mínimo 15 caracteres)',
                    ],
                  ] as const
                ).map(([name, label]) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={`${prefix}-${name}`}>
                      {label}
                    </FieldLabel>
                    <Input
                      id={`${prefix}-${name}`}
                      autoComplete={
                        name === 'ownerPassword' ? 'new-password' : 'off'
                      }
                      type={name === 'ownerPassword' ? 'password' : 'text'}
                      {...form.register(name)}
                      aria-invalid={!!form.formState.errors[name]}
                    />
                    <FieldError errors={[form.formState.errors[name]]} />
                  </Field>
                ))}
              </form>
            </div>
            <div hidden={step !== 2}>
              <ServiceForm
                key={draftId}
                formId={serviceFormId}
                hideSubmit
                disabled={saving}
                onSave={complete}
              />
            </div>
          </div>
          <DrawerFooter className="border-t bg-background p-6 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => changeOpen(false)}
            >
              Cancelar
            </Button>
            {step === 2 && (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setSaveError('')
                  setStep(1)
                }}
              >
                Atrás
              </Button>
            )}
            <Button
              type="submit"
              form={step === 1 ? clientFormId : serviceFormId}
              disabled={saving || form.formState.isSubmitting}
            >
              {saving
                ? 'Guardando…'
                : step === 1
                  ? 'Crear establecimiento'
                  : 'Añadir servicio'}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <Drawer
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null)
        }}
        swipeDirection="right"
      >
        <DrawerContent
          finalFocus={accessTriggerRef}
          className="w-full sm:w-[48rem] sm:max-w-[calc(100vw-2rem)]"
        >
          <DrawerHeader className="border-b p-6">
            <DrawerTitle className="text-xl">Gestionar accesos</DrawerTitle>
            <DrawerDescription>{selected?.venueName}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
            {selected && (
              <Members
                key={selected.venueId}
                venueId={selected.venueId}
                name={selected.venueName}
                compact
              />
            )}
          </div>
          <DrawerFooter className="border-t bg-background p-6 sm:flex-row sm:justify-end">
            <DrawerClose render={<Button variant="outline" />}>
              Cerrar
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
