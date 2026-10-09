import { useEffect, useRef, useState } from 'react'
import type {
  CommercialEstablishmentPage,
  CommercialEstablishmentSummary,
  ServiceInput,
} from '@noqueue/contracts/staff'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { ArrowRight } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router'
import searchIcon from '@/assets/administration/search.svg'
import menuIcon from '@/assets/administration/menu.svg'
import servicesIcon from '@/assets/administration/services.svg'
import clockIcon from '@/assets/administration/clock.svg'
import {
  CreateEstablishmentDrawer,
  type ClientInput,
} from './CreateEstablishmentDrawer'
import { api, errorMessage } from './api'

function listParams(
  current: URLSearchParams,
  draft: string,
  values: Record<string, string> = {},
) {
  const next = new URLSearchParams(current)
  const query = values.q ?? draft
  const changes: Record<string, string> = { ...values, q: query }
  // A new query starts at page one; otherwise honor the requested page.
  if (query !== (current.get('q') ?? '')) changes.page = '1'
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  return next
}

export function Commercial() {
  const [search, setSearch] = useSearchParams()
  const rawPage = search.get('page') ?? '1'
  const number = Number(rawPage)
  const validPage =
    /^[1-9]\d*$/.test(rawPage) &&
    Number.isSafeInteger(number) &&
    number <= Math.floor(Number.MAX_SAFE_INTEGER / 24)
  const page = validPage ? number : 1
  const q = search.get('q') ?? ''
  const rawStatus = search.get('status') ?? ''
  const status =
    rawStatus === 'active' || rawStatus === 'suspended' ? rawStatus : ''
  const location = useLocation()
  const [draftState, setDraftState] = useState({ value: q, key: location.key })
  if (draftState.key !== location.key)
    setDraftState({ value: q, key: location.key })
  const draft = draftState.key === location.key ? draftState.value : q
  const searchRef = useRef(search)
  useEffect(() => {
    searchRef.current = search
  }, [search])
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuTriggerRef = useRef<HTMLElement | null>(null)
  const [tab, setTab] = useState('establishments')
  const [menuOpen, setMenuOpen] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [revision, setRevision] = useState(0)
  const [customers, setCustomers] = useState<CommercialEstablishmentSummary[]>(
    [],
  )
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const requestKey = useRef(crypto.randomUUID())
  const fingerprint = useRef('')
  const [target, setTarget] = useState<CommercialEstablishmentSummary | null>(
    null,
  )
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusError, setStatusError] = useState('')
  const pendingOrganization = useRef<string | null>(null)

  function cancelPendingSearch() {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = null
  }
  function updateSearch(values: Record<string, string>, replace = false) {
    cancelPendingSearch()
    setSearch(listParams(searchRef.current, draft, values), { replace })
  }
  function pageUrl(value: number) {
    return `/staff?${listParams(search, draft, { page: String(value) })}`
  }
  useEffect(() => {
    if (!validPage || rawStatus !== status) {
      const next = new URLSearchParams(search)
      next.set('page', String(page))
      if (!status) next.delete('status')
      setSearch(next, { replace: true })
    }
  }, [validPage, rawStatus, status, page, search, setSearch])
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [location.key])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k' ||
        tab !== 'establishments' ||
        open ||
        menuOpen ||
        target ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return
      event.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [tab, open, menuOpen, target])
  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(() => {
        if (!active) return null
        setLoading(true)
        setError('')
        setCustomers([])
        setHasMore(false)
        const params = new URLSearchParams({ page: String(page) })
        if (q) params.set('q', q)
        if (status) params.set('status', status)
        return api<CommercialEstablishmentPage>(
          `/commercial/organizations?${params}`,
        )
      })
      .then((data) => {
        if (!data || !active) return
        setCustomers(data.items)
        setHasMore(data.hasMore)
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, q, status, revision])
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
      await api('/commercial/organizations', 'POST', input, requestKey.current)
      setOpen(false)
      fingerprint.current = ''
      setMessage(
        'Establecimiento creado. Entrega las credenciales al administrador por un canal seguro. El servicio se ha creado cerrado.',
      )
      refresh()
    } catch (cause) {
      setSaveError(errorMessage(cause))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  async function changeStatus() {
    if (!target || pendingOrganization.current) return
    pendingOrganization.current = target.id
    setStatusSaving(true)
    setStatusError('')
    const nextStatus = target.status === 'active' ? 'suspended' : 'active'
    try {
      await api(
        `/commercial/organizations/${encodeURIComponent(target.id)}/status`,
        'PATCH',
        { status: nextStatus },
      )
      setTarget(null)
      setMessage(
        nextStatus === 'active' ? 'Empresa reactivada.' : 'Empresa suspendida.',
      )
      if (page > 1) updateSearch({ page: '1' })
      else refresh()
    } catch (cause) {
      setStatusError(errorMessage(cause))
    } finally {
      pendingOrganization.current = null
      setStatusSaving(false)
    }
  }
  const returnParams = listParams(search, draft, { page: String(page) })
  const action =
    target?.status === 'active' ? 'Suspender empresa' : 'Reactivar empresa'
  return (
    <div className="space-y-[26px] md:pt-5">
      <header className="space-y-2">
        <h1 className="text-[32px] leading-[1.15] font-bold tracking-tight">
          Administración
        </h1>
        <p className="text-base text-muted-foreground">
          Gestiona tus establecimientos, servicios y actividad.
        </p>
      </header>
      {message && <p role="status">{message}</p>}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="gap-[30px]"
      >
        <TabsList
          variant="line"
          className="h-auto! w-full justify-start gap-[30px] border-b p-0"
        >
          <TabsTrigger
            value="establishments"
            className="h-auto flex-none rounded-none border-0 px-0 pt-0 pb-[13px] text-sm font-normal leading-[1.2] after:bottom-0!"
          >
            Establecimientos
          </TabsTrigger>
          <TabsTrigger
            value="metrics"
            className="h-auto flex-none rounded-none border-0 px-0 pt-0 pb-[13px] text-sm font-normal leading-[1.2] after:bottom-0!"
          >
            Métricas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="establishments" className="space-y-[30px]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex w-full flex-wrap items-center gap-3.5 lg:w-auto">
              <InputGroup className="h-10 w-full rounded-[9px] sm:w-[340px]">
                <InputGroupAddon>
                  <img src={searchIcon} alt="" />
                </InputGroupAddon>
                <InputGroupInput
                  ref={inputRef}
                  type="search"
                  aria-label="Buscar establecimiento o empresa"
                  placeholder="Buscar establecimiento"
                  value={draft}
                  onChange={(event) => {
                    const value = event.target.value
                    setDraftState({ value, key: location.key })
                    if (debounce.current) clearTimeout(debounce.current)
                    debounce.current = setTimeout(
                      () => updateSearch({ q: value, page: '1' }),
                      300,
                    )
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <Kbd className="border text-[11px]">
                    {typeof navigator !== 'undefined' &&
                    /Mac|iPhone|iPad/.test(navigator.userAgent)
                      ? '⌘'
                      : 'Ctrl'}{' '}
                    K
                  </Kbd>
                </InputGroupAddon>
              </InputGroup>
              <ToggleGroup
                aria-label="Estado de establecimientos"
                multiple={false}
                value={[status || 'all']}
                onValueChange={(values) => {
                  if (values[0])
                    updateSearch({
                      status: values[0] === 'all' ? '' : values[0],
                      page: '1',
                    })
                }}
                spacing={2}
              >
                {[
                  ['all', 'Todos'],
                  ['active', 'Activos'],
                  ['suspended', 'Inactivos'],
                ].map(([value, label]) => (
                  <ToggleGroupItem
                    key={value}
                    value={value!}
                    variant="outline"
                    className="h-8 rounded-full px-3 font-normal aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  >
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <CreateEstablishmentDrawer
              open={open}
              saving={saving}
              error={saveError}
              onOpenChange={changeOpen}
              onComplete={complete}
            />
          </div>
          {error && (
            <div className="space-y-2">
              <p role="alert" className="text-destructive">
                {error}
              </p>
              <Button variant="outline" disabled={loading} onClick={refresh}>
                Reintentar
              </Button>
            </div>
          )}
          <section aria-label="Listado de establecimientos" aria-busy={loading}>
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
                  : q || status
                  ? 'No hay establecimientos que coincidan con los filtros.'
                  : 'Todavía no hay establecimientos. Crea el primero para empezar.'}
              </p>
            )}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {customers.map((customer) => (
                <Card
                  key={customer.venueId}
                  className="min-w-0 gap-6 rounded-xl p-6 pb-2 shadow-[0_2px_8px_rgba(16,24,40,0.04)] ring-0 border"
                >
                  <div className="space-y-5">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <Avatar className="size-11 shrink-0 rounded-[10px] after:hidden">
                        <AvatarFallback className="rounded-[10px] bg-slate-200 text-[13px] font-bold text-black">
                          {customer.venueName
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((word) => word[0])
                            .join('')
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <h2 className="break-words text-[17px] font-normal leading-[1.2]">
                          {customer.venueName}
                        </h2>
                        <p className="mt-1 break-words text-[13px] leading-[1.35] text-muted-foreground">
                          {customer.name}
                        </p>
                      </div>
                      <DropdownMenu onOpenChange={setMenuOpen}>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon" />}
                          aria-label={`Acciones de ${customer.venueName}`}
                          disabled={statusSaving}
                          onClick={(event) => {
                            menuTriggerRef.current = event.currentTarget
                          }}
                        >
                          <img src={menuIcon} alt="" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto">
                          <DropdownMenuItem
                            onClick={() => {
                              setStatusError('')
                              setTarget(customer)
                            }}
                          >
                            {customer.status === 'active'
                              ? 'Suspender empresa'
                              : 'Reactivar empresa'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Badge
                        className={
                          customer.status === 'active'
                            ? 'h-[26px] rounded-md bg-emerald-50 px-3 py-1 font-normal text-emerald-700'
                            : 'h-[26px] rounded-md bg-slate-100 px-3 py-1 font-normal text-slate-600'
                        }
                      >
                        {customer.status === 'active' ? 'Activo' : 'Inactivo'}
                      </Badge>
                      <span className="flex items-center gap-2 text-sm">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[#fafbfc]">
                          <img src={servicesIcon} alt="" />
                        </span>
                        {customer.serviceCount == null
                          ? 'Servicios no disponibles'
                          : `${customer.serviceCount} ${
                              customer.serviceCount === 1
                                ? 'Servicio'
                                : 'Servicios'
                            }`}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-2">
                    <span className="flex min-w-0 items-center gap-[7px] text-xs text-muted-foreground">
                      <img src={clockIcon} alt="" className="shrink-0" />
                      {customer.configurationUpdatedAt == null
                        ? 'Fecha de actualización no disponible'
                        : `Última actualización: ${new Intl.DateTimeFormat(
                            'es-ES',
                            { day: 'numeric', month: 'short', year: 'numeric' },
                          ).format(customer.configurationUpdatedAt)}`}
                    </span>
                    <Button
                      variant="link"
                      size="sm"
                      nativeButton={false}
                      role="link"
                      render={
                        <Link
                          to={`/staff/establishments/${customer.venueId}`}
                          state={{
                            returnPage: Number(returnParams.get('page')),
                            returnSearch: returnParams.toString(),
                          }}
                        />
                      }
                      aria-label={`Gestionar ${customer.venueName}`}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.altKey ||
                          event.shiftKey
                        )
                          return
                        cancelPendingSearch()
                        // Replace the list entry before Link pushes detail, preserving native Back.
                        if (draft !== q)
                          setSearch(returnParams, {
                            replace: true,
                            state: location.state,
                          })
                      }}
                    >
                      Gestionar
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
          {(page > 1 || hasMore) && (
            <Pagination aria-label="Paginación de establecimientos">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    text="Anterior"
                    aria-label="Página anterior"
                    href={pageUrl(Math.max(1, page - 1))}
                    aria-disabled={page === 1 || loading}
                    tabIndex={page === 1 || loading ? -1 : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      if (page > 1 && !loading)
                        updateSearch({ page: String(page - 1) })
                    }}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink
                    isActive
                    href={pageUrl(page)}
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
                    href={pageUrl(page + 1)}
                    aria-disabled={!hasMore || loading}
                    tabIndex={!hasMore || loading ? -1 : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      if (hasMore && !loading)
                        updateSearch({ page: String(page + 1) })
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </TabsContent>
        <TabsContent value="metrics">
          <p className="py-10 text-center text-muted-foreground">
            Las métricas estarán disponibles próximamente
          </p>
        </TabsContent>
      </Tabs>
      <AlertDialog
        open={!!target}
        onOpenChange={(next) => {
          if (!next && !pendingOrganization.current) setTarget(null)
        }}
      >
        <AlertDialogContent finalFocus={menuTriggerRef}>
          <AlertDialogHeader>
            <AlertDialogTitle>{action}</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción afectará a todos los establecimientos de la empresa{' '}
              {target?.name}.{' '}
              {target?.status === 'active'
                ? 'Sus accesos dejarán de estar disponibles hasta que reactives la empresa.'
                : 'Sus accesos volverán a estar disponibles.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {statusError && (
            <p role="alert" className="text-destructive">
              {statusError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={statusSaving}>
              Cancelar
            </AlertDialogCancel>
            <Button disabled={statusSaving} onClick={() => void changeStatus()}>
              {statusSaving ? 'Guardando…' : action}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
