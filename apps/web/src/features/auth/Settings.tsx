import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { esES } from '@better-auth-ui/locales/es-ES'
import { AuthProvider } from '@/components/auth/auth-provider'
import { Settings } from '@/components/auth/settings/settings'
import { authClient } from '@/data/auth/client'
import { Toaster } from 'sonner'
export function AccountSettingsPage() {
  const navigate = useNavigate(),
    { view } = useParams(),
    [query] = useSearchParams()
  return (
    <AuthProvider
      authClient={authClient}
      locale={esES}
      navigate={({ to }) => navigate(to)}
      Link={({ href, ...props }) => <Link to={href} {...props} />}
      basePaths={{ auth: '', settings: '/settings' }}
      viewPaths={{ auth: { signIn: 'login' } }}
      redirectTo="/staff"
      avatar={{ enabled: false }}
      emailAndPassword={{ minPasswordLength: 15, maxPasswordLength: 128 }}
    >
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <Link to="/staff">← Volver al dashboard</Link>
        <h1 className="text-2xl font-semibold">Ajustes de cuenta</h1>
        {query.has('error') && (
          <p role="alert">
            No se pudo verificar el email. El enlace puede haber caducado.
            Solicita de nuevo el cambio desde esta página.
          </p>
        )}
        <Settings view={view === 'security' ? 'security' : 'account'} />
      </main>
      <Toaster />
    </AuthProvider>
  )
}
