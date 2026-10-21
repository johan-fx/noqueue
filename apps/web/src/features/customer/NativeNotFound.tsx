import { Link } from 'react-router'
import { useLocale } from './public-resource'
import { CustomerShell } from './shared'

export function NativeNotFound() {
  const [locale, setLocale] = useLocale()
  const es = locale === 'es'
  return <CustomerShell title="No Queue" locale={locale} setLocale={setLocale}>
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">{es ? 'Este enlace no está disponible en la app' : 'This link is not available in the app'}</h1>
      <Link className="block py-2 underline" to={`/search?lang=${locale}`}>{es ? 'Buscar un establecimiento' : 'Find a venue'}</Link>
    </div>
  </CustomerShell>
}
