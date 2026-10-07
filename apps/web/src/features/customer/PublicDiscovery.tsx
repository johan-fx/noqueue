import { useLocale } from './public-resource'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
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
    search: 'Busca un establecimiento',
    more: 'Ver más',
    wait: 'Menos espera',
    nearest: 'Más cerca',
    loading: 'Cargando servicios…',
    empty: 'No hay servicios disponibles.',
    nearbyEmpty: 'No hay servicios disponibles en un radio de 5 km.',
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
    search: 'Search for a venue',
    more: 'See more',
    wait: 'Shortest wait',
    nearest: 'Nearest',
    loading: 'Loading services…',
    empty: 'No services available.',
    nearbyEmpty: 'No services available within 5 km.',
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
  const navigate = useNavigate(),
    route = useLocation()
  const [params, setParams] = useSearchParams()
  const typeValue = params.get('type'),
    type =
      typeValue === 'restaurant' ||
      typeValue === 'reception' ||
      typeValue === 'pool'
        ? typeValue
        : undefined
  const scope =
    coordinates && (!search || params.get('scope') === 'nearby')
      ? 'nearby'
      : 'global'
  const sort =
    coordinates &&
    (params.get('sort') === 'distance' ||
      (!params.has('sort') && scope === 'nearby'))
      ? 'distance'
      : 'wait'
  const page = Math.max(1, Math.min(1000, Number(params.get('page')) || 1))
  const text = search ? params.get('text') ?? '' : ''
  const [geoError, setGeoError] = useState(false),
    [locating, setLocating] = useState(false),
    [scan, setScan] = useState(false),
    [revision, setRevision] = useState(0)
  const recent = recentServiceIds()
  const body: PublicSearchInput = {
    text,
    type,
    scope,
    coordinates,
    sort,
    page,
    pageSize: search ? 24 : 3,
    ...(!search && !coordinates ? { recentIds: recent } : {}),
  }
  const bodyKey = JSON.stringify(body)
  const [loaded, setLoaded] = useState<{
    key: string
    items: PublicSearchResult[]
    hasMore: boolean
  } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const data = loaded?.key === bodyKey ? loaded : null
  const shouldSearch = search || !!coordinates || recent.length > 0
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
        const response = await fetch('/api/v1/public/search', {
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
            items: result.items,
            hasMore: result.hasMore,
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
    timer = setTimeout(() => void refresh(), search && text ? 300 : 0)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearTimeout(timer)
      controller.abort()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [bodyKey, revision, shouldSearch, search, text])
  useEffect(() => {
    if (data && search) window.scrollTo(0, discoveryScroll.get(returnTo) ?? 0)
  }, [data, search, returnTo])
  useEffect(
    () => () => {
      if (search) discoveryScroll.set(returnTo, window.scrollY)
    },
    [search, returnTo],
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
    if (!navigator.geolocation) {
      setGeoError(true)
      setLocating(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDiscoveryCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setLocating(false)
      },
      () => {
        setGeoError(true)
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    )
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
        <p role="status" className="text-sm text-gray-500">
          {t.loading}
        </p>
      )}
      {failure === bodyKey && (
        <div className="space-y-3">
          <p role="alert">{t.error}</p>
          <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
            {t.retry}
          </Button>
        </div>
      )}
      {data && !data.items.length && (
        <p role="status" className="text-sm text-gray-500">
          {scope === 'nearby' && !text ? t.nearbyEmpty : t.empty}
        </p>
      )}
      {data?.items.map((service) => (
        <ServiceResult
          key={service.id}
          service={service}
          locale={locale}
          returnTo={returnTo}
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
              <Button
                variant="ghost"
                className="h-12 text-sm!"
                onClick={openSearch}
              >
                <Search className="size-4" />
                {t.more}
              </Button>
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
                  onClick={locate}
                  className="flex w-full items-center gap-4 rounded-xl border border-gray-300 p-3 text-left disabled:opacity-60"
                >
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
