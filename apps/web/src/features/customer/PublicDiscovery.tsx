import { LoadingSpinner } from '@/components/LoadingSpinner'
import { detectRuntime } from '@/app/bootstrap/runtime'
import { useNativeResourceSeed } from '@/platform/capacitor/native-route-data'
import { discoveryRequest, discoveryResourceKey } from './discovery-request'
import { useAppNavigate } from '@/app/navigation/native-transitions'
import { discoveryPosition } from '@/platform/capacitor/discovery-capabilities'
import { usePublicAnalyticsPage } from '@/features/privacy/use-public-analytics-page'
import { customerFetch } from '@/data/api/customer'
import { useLocale } from './public-resource'
import { isActivePublicList } from '@noqueue/contracts/queue'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { ArrowRight, Clock, MapPin, QrCode, Search } from 'lucide-react'
import {
  publicSearchResponseSchema,
  type PublicSearchInput,
  type PublicSearchResult,
} from '@noqueue/contracts/discovery'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { CustomerShell } from './shared'
import {
  discoveryScroll,
  recentServiceIds,
  setDiscoveryCoordinates,
  useDiscoveryCoordinates,
} from './discovery-state'
import { ServiceResult } from './ServiceResult'
import { QrScanner } from './QrScanner'
const copy = {
  es: {
    hero: '¿Dónde quieres unirte a la lista de espera?',
    intro:
      'Escanea el QR del local, usa tu ubicación o busca el establecimiento.',
    searchTitle: 'Busca tu establecimiento',
    searchIntro:
      'Encuentra el hotel, restaurante o local donde quieres apuntarte.',
    placeholder: 'Hotel, restaurante o local',
    scan: 'Escanear QR',
    scanHint: 'Accede directamente a la lista.',
    location: 'Usar mi ubicación',
    locationHint: 'Servicios cercanos a ti',
    locationActive: 'Ubicación activada',
    removeLocation: 'Quitar',
    disableLocation: 'Desactivar ubicación',
    locationResetHint: 'Vuelve al inicio y busca sin límite de distancia.',
    nearbyEmptyTitle: 'No hay servicios cerca de ti',
    search: 'Busca un establecimiento',
    more: 'Ver más',
    wait: 'Menos espera',
    nearest: 'Más cerca',
    loading: 'Cargando servicios…',
    empty: 'No hay servicios disponibles.',
    nearbyEmpty: 'No encontramos servicios disponibles en un radio de 5 km.',
    error: 'No podemos cargar los servicios. Inténtalo de nuevo.',
    geoError:
      'No podemos acceder a tu ubicación. Puedes buscar el establecimiento.',
    retry: 'Reintentar',
    recent: 'Servicios recientes',
    next: 'Siguiente',
    previous: 'Anterior',
  },
  en: {
    hero: 'Where would you like to join the waiting list?',
    intro: 'Scan the venue QR, use your location or search for a venue.',
    searchTitle: 'Find your venue',
    searchIntro: 'Find the hotel, restaurant or venue you want to join.',
    placeholder: 'Hotel, restaurant or venue',
    scan: 'Scan QR',
    scanHint: 'Go directly to the waiting list.',
    location: 'Use my location',
    locationHint: 'We will show nearby services',
    locationActive: 'Location enabled',
    removeLocation: 'Remove',
    disableLocation: 'Turn off location',
    locationResetHint: 'Return home and search without a distance limit.',
    nearbyEmptyTitle: 'No services near you',
    search: 'Search for a venue',
    more: 'See more',
    wait: 'Shortest wait',
    nearest: 'Nearest',
    loading: 'Loading services…',
    empty: 'No services available.',
    nearbyEmpty: 'We found no services available within 5 km.',
    error: 'Cannot load services. Please try again.',
    geoError: 'Cannot access your location. You can search for the venue.',
    retry: 'Retry',
    recent: 'Recent services',
    next: 'Next',
    previous: 'Previous',
  },
}
export function PublicDiscovery({ search = false }: { search?: boolean }) {
  const [locale, setLocale] = useLocale(),
    t = copy[locale]
  const coordinates = useDiscoveryCoordinates()
  const navigate = useAppNavigate(),
    route = useLocation()
  const [params, setParams] = useSearchParams()
  const [geoError, setGeoError] = useState(false),
    [locating, setLocating] = useState(false),
    [scan, setScan] = useState(false),
    [revision, setRevision] = useState(0)
  const recent = recentServiceIds()
  const { body, shouldSearch } = discoveryRequest(params, search, coordinates, recent)
  const { type, scope, sort, page, text = '' } = body
  const bodyKey = JSON.stringify(body)
  const seed = useNativeResourceSeed(discoveryResourceKey(bodyKey))
  const native = detectRuntime() === 'native'
  const priorRevision = useRef(0)
  const [loaded, setLoaded] = useState<{
    key: string
    items: PublicSearchResult[]
    hasMore: boolean
    updatedAt: number
  } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const initial = seed && !seed.error ? publicSearchResponseSchema.parse(seed.data) : null
  const seeded = initial ? { key: bodyKey, items: initial.items.filter(isActivePublicList), hasMore: initial.hasMore, updatedAt: seed!.updatedAt } : null
  const data = loaded?.key === bodyKey && (!seeded || loaded.updatedAt >= seeded.updatedAt) ? loaded : seeded
  const failed = failure === bodyKey || Boolean(seed?.error && !data)
  usePublicAnalyticsPage(!shouldSearch || Boolean(data), failed)
  const returnTo = route.pathname + route.search
  const closeScan = useCallback(() => setScan(false), [setScan])
  useEffect(() => {
    if (!shouldSearch) return
    const controller = new AbortController()
    const isVisible = () => document.visibilityState !== 'hidden'
    let pending = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      if (pending || controller.signal.aborted || !isVisible()) return
      clearTimeout(timer)
      pending = true
      try {
        const response = await customerFetch('/api/v1/public/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyKey,
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('unavailable')
        const result = publicSearchResponseSchema.parse(await response.json())
        if (!controller.signal.aborted) {
          setLoaded({
            key: bodyKey,
            items: result.items.filter(isActivePublicList),
            hasMore: result.hasMore,
            updatedAt: Date.now(),
          })
          setFailure(null)
        }
      } catch {
        if (!controller.signal.aborted) setFailure(bodyKey)
      } finally {
        pending = false
        if (!controller.signal.aborted && isVisible())
          timer = setTimeout(() => void refresh(), 5000)
      }
    }
    const focus = () => {
      void refresh()
    }
    const visibility = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'hidden') void refresh()
    }
    const hasInitial = seed && priorRevision.current === revision
    priorRevision.current = revision
    timer = setTimeout(() => void refresh(), hasInitial ? 5000 : search && text ? 300 : 0)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearTimeout(timer)
      controller.abort()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [bodyKey, revision, shouldSearch, search, text, seed])
  useEffect(() => {
    if (!native && data && search) window.scrollTo(0, discoveryScroll.get(returnTo) ?? 0)
  }, [data, search, returnTo, native])
  useLayoutEffect(() => {
    if (native && search && data?.key) window.scrollTo({ top: discoveryScroll.get(returnTo) ?? 0, left: 0, behavior: 'instant' })
  }, [native, search, returnTo, data?.key])
  useLayoutEffect(() => () => {
    if (native && search) discoveryScroll.set(returnTo, window.scrollY)
  }, [native, search, returnTo])
  useEffect(
    () => () => {
      if (!native && search) discoveryScroll.set(returnTo, window.scrollY)
    },
    [native, search, returnTo],
  )
  function toggleType(next: NonNullable<PublicSearchInput['type']>) {
    setParams(
      (previous) => {
        if (type === next) previous.delete('type')
        else previous.set('type', next)
        previous.delete('page')
        return previous
      },
      { replace: true },
    )
  }
  function locate() {
    if (locating) return
    setGeoError(false)
    setLocating(true)
    void discoveryPosition().then(
      position => setDiscoveryCoordinates(position),
      () => setGeoError(true),
    ).finally(() => setLocating(false))
  }

  function openSearch() {
    const next = new URLSearchParams({ lang: locale })
    if (coordinates) {
      next.set('scope', 'nearby')
      next.set('sort', 'distance')
    }
    if (type) next.set('type', type)
    navigate(`/search?${next}`)
  }
  function clearLocation() {
    // Clear the shared in-memory position before native route preparation reads it.
    // This resets discovery, not the browser/device's location permission.
    setDiscoveryCoordinates(undefined)
    setGeoError(false)
    setLoaded(null)
    setFailure(null)
    navigate(`/?lang=${locale}`, { replace: true, intent: 'back' })
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }
  const filters = (
    <div
      className="flex min-w-0 gap-2 overflow-x-auto pb-1"
      aria-label={
        locale === 'es' ? 'Filtrar por servicio' : 'Filter by service'
      }
    >
      {(['restaurant', 'reception', 'pool'] as const).map((value) => (
        <Button
          key={value}
          variant={type === value ? 'default' : 'ghost'}
          size="sm"
          className="shrink-0 rounded-2xl px-2.5 text-sm!"
          aria-pressed={type === value}
          onClick={() => toggleType(value)}
        >
          {locale === 'es'
            ? {
                restaurant: 'Restaurantes',
                reception: 'Recepción',
                pool: 'Bar piscina',
              }[value]
            : {
                restaurant: 'Restaurants',
                reception: 'Reception',
                pool: 'Pool bar',
              }[value]}
        </Button>
      ))}
    </div>
  )
  const results = (
    <section
      className="space-y-3"
      aria-label={locale === 'es' ? 'Servicios' : 'Services'}
      aria-busy={shouldSearch && !data && failure !== bodyKey}
    >
      {shouldSearch && !data && failure !== bodyKey && (
        native ? <LoadingSpinner locale={locale} /> : (
          <p role="status" className="text-sm text-gray-500">
            {t.loading}
          </p>
        )
      )}
      {failed && (
        <div className="space-y-3">
          <p role="alert">{t.error}</p>
          <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
            {t.retry}
          </Button>
        </div>
      )}
      {data && !data.items.length && (
        scope === 'nearby' && !text ? (
          <div className="space-y-5 py-3 text-center">
            <div role="status" className="space-y-3">
              <MapPin className="mx-auto size-8 text-gray-500" aria-hidden="true" />
              <h2 className="text-lg font-semibold">{t.nearbyEmptyTitle}</h2>
              <p className="text-sm leading-6 text-gray-500">{t.nearbyEmpty}</p>
            </div>
            <div className="space-y-3">
              <Button className="h-12 w-full rounded-xl" onClick={clearLocation}>
                {t.disableLocation}
              </Button>
              <p className="text-sm text-gray-500">{t.locationResetHint}</p>
            </div>
          </div>
        ) : <p role="status" className="text-sm text-gray-500">{t.empty}</p>
      )}
      {data?.items.map((service) => (
        <ServiceResult
          key={service.id}
          service={service}
          locale={locale}
        />
      ))}
      {!!data?.items.length && (
        <p className="text-[10px] text-gray-500">
          {[
            ...new Map(
              data.items.flatMap((i) => i.attribution).map((a) => [a.url, a]),
            ).values(),
          ].map((a, i) => (
            <span key={a.url}>
              {i ? ' · ' : ''}
              <a href={a.url} target="_blank" rel="noreferrer">
                {a.text}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  )
  const qrCard = (
    <button
      type="button"
      onClick={() => setScan(true)}
      className="flex w-full items-center gap-4 rounded-xl border border-gray-300 p-3 text-left"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gray-100">
        <QrCode className="size-6" aria-hidden="true" />
      </span>
      <span className="flex-1 space-y-1">
        <span className="block text-lg font-semibold">{t.scan}</span>
        <span className="block text-sm text-gray-500">{t.scanHint}</span>
      </span>
      <ArrowRight className="size-6" aria-hidden="true" />
    </button>
  )
  return (
    <div className="font-sans [&_header>p]:pl-2 [&_header>p]:text-lg">
      <CustomerShell
        title={search ? '' : 'No Queue'}
        back={search ? `/?lang=${locale}` : undefined}
        locale={locale}
        setLocale={setLocale}
      >
        <div className={`flex flex-col gap-6 ${search ? 'px-5' : 'px-4'} py-6`}>
          <div className="space-y-3">
            <h1
              className={
                search
                  ? 'text-2xl leading-8 font-semibold text-gray-900'
                  : 'text-3xl leading-9 font-semibold'
              }
            >
              {search ? t.searchTitle : t.hero}
            </h1>
            <p className="text-base leading-6 text-gray-500">
              {search ? t.searchIntro : t.intro}
            </p>
          </div>
          {coordinates && (
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-2">
              <MapPin className="size-5 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-sm">{t.locationActive}</span>
              <Button variant="ghost" className="min-h-11 shrink-0 px-3 font-semibold" onClick={clearLocation}>
                {t.removeLocation}
              </Button>
            </div>
          )}
          {search ? (
            <>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-gray-400"
                />
                <Input
                  aria-label={t.placeholder}
                  placeholder={t.placeholder}
                  maxLength={200}
                  value={text}
                  onChange={(e) =>
                    setParams(
                      (previous) => {
                        previous.set('text', e.target.value)
                        previous.delete('page')
                        return previous
                      },
                      { replace: true },
                    )
                  }
                  className="h-13 rounded-xl bg-gray-50/50 pl-11 text-base!"
                />
              </div>
              <div className="-mt-2 flex gap-2 overflow-hidden">
                <Select
                  items={[
                    { value: 'wait', label: t.wait },
                    { value: 'distance', label: t.nearest },
                  ]}
                  value={sort}
                  onValueChange={(value) => {
                    if (value !== 'wait' && value !== 'distance') return
                    if (value === 'distance' && !coordinates) return
                    setParams(
                      (previous) => {
                        previous.set('sort', value)
                        previous.delete('page')
                        return previous
                      },
                      { replace: true },
                    )
                  }}
                >
                  <SelectTrigger
                    aria-label={locale === 'es' ? 'Ordenar' : 'Sort'}
                    size="default"
                    className="w-auto shrink-0 rounded-lg font-medium text-black"
                  >
                    {sort === 'distance' ? (
                      <MapPin className="size-4" aria-hidden="true" />
                    ) : (
                      <Clock className="size-4" aria-hidden="true" />
                    )}
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    <SelectItem value="wait">{t.wait}</SelectItem>
                    <SelectItem value="distance" disabled={!coordinates}>
                      {t.nearest}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {filters}
              </div>
              {results}
              {(page > 1 || data?.hasMore) && (
                <div className="flex justify-between">
                  <Button
                    variant="outline"
                    disabled={page === 1}
                    onClick={() =>
                      setParams((previous) => {
                        previous.set('page', String(page - 1))
                        return previous
                      })
                    }
                  >
                    {t.previous}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!data?.hasMore}
                    onClick={() =>
                      setParams((previous) => {
                        previous.set('page', String(page + 1))
                        return previous
                      })
                    }
                  >
                    {t.next}
                  </Button>
                </div>
              )}
            </>
          ) : coordinates ? (
            <>
              {filters}
              {results}
              {!!data?.items.length && (
                <Button
                  variant="ghost"
                  className="h-12 text-sm!"
                  onClick={openSearch}
                >
                  <Search className="size-4" />
                  {t.more}
                </Button>
              )}
              <Divider locale={locale} />
              {qrCard}
              <Button variant="outline" onClick={openSearch}>
                <Search className="size-4" />
                {t.search}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-3">
                {qrCard}
                <button
                  type="button"
                  disabled={locating}
                  aria-label={native ? t.location : undefined}
                  aria-busy={locating}
                  onClick={locate}
                  className="flex w-full items-center gap-4 rounded-xl border border-gray-300 p-3 text-left disabled:opacity-60"
                >
                  {native && locating ? (
                    <LoadingSpinner locale={locale} className="h-13 py-0" />
                  ) : (
                    <>
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gray-100">
                        <MapPin className="size-6" aria-hidden="true" />
                      </span>
                      <span className="flex-1 space-y-1">
                        <span className="block text-lg font-semibold">
                          {t.location}
                        </span>
                        <span className="block text-sm text-gray-500">
                          {locating ? t.loading : t.locationHint}
                        </span>
                      </span>
                      <ArrowRight className="size-6" aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
              {geoError && (
                <p role="alert" className="text-sm text-gray-500">
                  {t.geoError}
                </p>
              )}
              <Divider locale={locale} />
              <Button
                variant="outline"
                className="h-13 justify-start p-4 text-sm! font-semibold"
                onClick={openSearch}
              >
                <Search className="size-4" />
                {t.search}
              </Button>
              {recent.length > 0 && (
                <>
                  <h2 className="sr-only">{t.recent}</h2>
                  {results}
                </>
              )}
            </>
          )}
        </div>
        {scan && <QrScanner locale={locale} onClose={closeScan} />}
      </CustomerShell>
    </div>
  )
}
function Divider({ locale }: { locale: 'es' | 'en' }) {
  return (
    <div className="flex items-center gap-4 text-sm text-gray-400">
      <span className="h-px flex-1 bg-gray-100" />
      {locale === 'es' ? 'o' : 'or'}
      <span className="h-px flex-1 bg-gray-100" />
    </div>
  )
}
