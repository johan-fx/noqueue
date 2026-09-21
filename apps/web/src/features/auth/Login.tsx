import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router'
import { authClient } from '@/data/auth/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
const schema = z.object({
  identifier: z.string().trim().min(3),
  password: z.string().min(1).max(128),
})
export function Login() {
  const navigate = useNavigate(),
    [error, setError] = useState('')
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  })
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>NoQueue · Acceso profesional</CardTitle>
          <CardDescription>
            Utiliza el usuario y la contraseña que te ha entregado tu
            administrador. No necesitas email para empezar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit(async ({ identifier, password }) => {
              setError('')
              try {
                const result = identifier.includes('@')
                  ? await authClient.signIn.email({
                      email: identifier,
                      password,
                    })
                  : await authClient.signIn.username({
                      username: identifier,
                      password,
                    })
                if (result.error) throw new Error()
                form.reset()
                navigate('/staff')
              } catch {
                setError('Credenciales incorrectas o acceso no disponible.')
                form.setValue('password', '')
              }
            })}
          >
            <Field>
              <FieldLabel htmlFor="identifier">Usuario o email</FieldLabel>
              <Input
                id="identifier"
                autoComplete="username"
                {...form.register('identifier')}
              />
              <FieldError errors={[form.formState.errors.identifier]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Contraseña</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...form.register('password')}
              />
              <FieldError errors={[form.formState.errors.password]} />
            </Field>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
              Entrar
            </Button>
            <p className="text-sm text-muted-foreground">
              Si has olvidado tu contraseña, contacta con el administrador del
              establecimiento o con NoQueue.
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
