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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Link, useSearchParams } from 'react-router'

import {
  CreateEstablishmentDrawer,
  type ClientInput,
} from './CreateEstablishmentDrawer'
import { api, errorMessage } from './api'

type Customer = {
  id: string
  name: string
  slug: string
  status: string
  venueId: string
  venueName: string
}

type CustomerPage = { items: Customer[]; page: number; hasMore: boolean }
export function Commercial() {
  const [search, setSearch] = useSearchParams()
  const rawPage = search.get('page') ?? '1'
  const number = Number(rawPage)
  const validPage =
    /^[1-9]\d*$/.test(rawPage) &&
    Number.isSafeInteger(number) &&
    number <= Math.floor(Number.MAX_SAFE_INTEGER / 24)
  const page = validPage ? number : 1
  const [hasMore, setHasMore] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!validPage) setSearch({ page: '1' }, { replace: true })
  }, [validPage, setSearch])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const requestKey = useRef(crypto.randomUUID())
  const fingerprint = useRef('')

  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(() => {
        if (!active) return null
        setLoading(true)
        setError('')
        setCustomers([])
        setHasMore(false)
        return api<CustomerPage>(`/commercial/organizations?page=${page}`)
      })
      .then((data) => {
        if (!data || !active) return
        setCustomers(data.items)
        setHasMore(data.hasMore)
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
  }, [page, revision])

  function refresh() {
    setRevision((value) => value + 1)
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
      await api(
        '/commercial/organizations',
        'POST',
        input,
        requestKey.current,
      )
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
        <CardHeader className="has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
          <CardTitle>
            <h1 className="text-xl font-semibold">Establecimientos</h1>
          </CardTitle>
          <CardDescription>
            Gestiona tus clientes y sus accesos a NoQueue.
          </CardDescription>
          <CardAction className="col-start-1 row-start-auto row-span-1 justify-self-start sm:col-start-2 sm:row-start-1 sm:row-span-2 sm:justify-self-end">
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
          <section
            aria-label="Listado de establecimientos"
            aria-busy={loading}
          >
            {!customers.length && (
              <p
                role="status"
                className="py-10 text-center text-muted-foreground"
              >
                {loading
                  ? 'Cargando establecimientos…'
                  : error
                  ? 'Listado no disponible.'
                  : page > 1
                  ? 'No hay establecimientos en esta página.'
                  : 'Todavía no hay establecimientos. Crea el primero para empezar.'}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {customers.map((customer) => {
                const content = (
                  <>
                    <CardHeader>
                      <CardTitle className="break-words">
                        {customer.venueName}
                      </CardTitle>
                      <CardDescription className="break-words">
                        {customer.name}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Badge
                        variant={
                          customer.status === 'active'
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {customer.status === 'active'
                          ? 'Activo'
                          : 'Suspendido'}
                      </Badge>
                    </CardContent>
                  </>
                )
                return (
                  <Link
                    key={customer.venueId}
                    to={`/staff/establishments/${customer.venueId}`}
                    state={{ returnPage: page }}
                    className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                  >
                    <Card className="h-full transition-colors hover:bg-muted/50">
                      {content}
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
          {(page > 1 || hasMore) && (
            <Pagination
              aria-label="Paginación de establecimientos"
              className="mt-6"
            >
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    text="Anterior"
                    aria-label="Página anterior"
                    href={`/staff?page=${Math.max(1, page - 1)}`}
                    aria-disabled={page === 1 || loading}
                    tabIndex={page === 1 || loading ? -1 : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      if (page > 1 && !loading)
                        setSearch({ page: String(page - 1) })
                    }}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink
                    isActive
                    href={`/staff?page=${page}`}
                    aria-label={`Página ${page}`}
                    onClick={(event) => event.preventDefault()}
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    text="Siguiente"
                    aria-label="Página siguiente"
                    href={`/staff?page=${page + 1}`}
                    aria-disabled={!hasMore || loading}
                    tabIndex={!hasMore || loading ? -1 : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      if (hasMore && !loading)
                        setSearch({ page: String(page + 1) })
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
