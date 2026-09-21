import { useEffect, useRef, useState } from 'react'
import type { ServiceInput } from '@noqueue/contracts/staff'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CreateEstablishmentDrawer,
  type ClientInput,
} from './CreateEstablishmentDrawer'
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

export function Commercial() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selected, setSelected] = useState<Customer | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const requestKey = useRef(crypto.randomUUID())
  const fingerprint = useRef('')
  const accessTriggerRef = useRef<HTMLButtonElement | null>(null)

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
    if (next) setMessage('')
    setSaveError('')
    fingerprint.current = ''
    requestKey.current = crypto.randomUUID()
  }

  async function complete(client: ClientInput, service: ServiceInput) {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setSaveError('')
    const input = { ...client, services: [service] }
    const next = JSON.stringify(input)
    if (fingerprint.current !== next) {
      requestKey.current = crypto.randomUUID()
      fingerprint.current = next
    }
    try {
      await api('/commercial/organizations', 'POST', input, requestKey.current)
      setOpen(false)
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
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">Establecimientos</h1>
          </CardTitle>
          <CardDescription>
            Gestiona tus clientes y sus accesos a NoQueue.
          </CardDescription>
          <CardAction>
            <CreateEstablishmentDrawer
              open={open}
              saving={saving}
              error={saveError}
              onOpenChange={changeOpen}
              onComplete={complete}
            />
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
      <Drawer
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null)
        }}
        swipeDirection="right"
      >
        <DrawerContent
          finalFocus={accessTriggerRef}
          className="w-full sm:w-md"
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
