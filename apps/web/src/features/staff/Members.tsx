import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { inviteSchema } from '@noqueue/contracts/staff'
import type { z } from 'zod'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { PasswordReset } from './PasswordReset'
import { Choice } from './ServiceForm'
import { api, errorMessage } from './api'
const labels = {
  venue_manager: 'Responsable de zona',
  queue_staff: 'Personal de cola',
  viewer: 'Solo lectura',
}
type Member = {
  id: string
  name: string
  username: string
  role: string
  active: number
}
type Data = { members: Member[] }
export function Members({
  venueId,
  name,
  compact = false,
}: {
  venueId: string
  name: string
  compact?: boolean
}) {
  const [data, setData] = useState<Data>({ members: [] }),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      name: '',
      username: '',
      password: '',
      role: 'queue_staff',
    },
  })
  const load = () => api<Data>(`/venues/${venueId}/members`).then(setData)
  useEffect(() => {
    void api<Data>(`/venues/${venueId}/members`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)))
  }, [venueId])
  async function action(path: string, method: string, body?: unknown) {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await api(path, method, body)
      setNotice(
        'Operación guardada. Entrega las credenciales por un canal seguro.',
      )
      form.reset()
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accesos · {name}</CardTitle>
        <CardDescription>
          El administrador no puede ser eliminado ni degradado desde esta
          pantalla. No se comparten contraseñas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <form
          onSubmit={form.handleSubmit(async (input) => {
            await action(`/venues/${venueId}/members`, 'POST', input)
          })}
          className={
            compact
              ? 'grid items-end gap-4 sm:grid-cols-2'
              : 'grid items-end gap-4 md:grid-cols-4'
          }
        >
          <Field>
            <FieldLabel htmlFor="invite-name">Nombre</FieldLabel>
            <Input id="invite-name" {...form.register('name')} />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-username">Usuario</FieldLabel>
            <Input
              id="invite-username"
              autoComplete="off"
              {...form.register('username')}
            />
            <FieldError errors={[form.formState.errors.username]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="initial-password">
              Contraseña inicial (15 caracteres)
            </FieldLabel>
            <Input
              id="initial-password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            <FieldError errors={[form.formState.errors.password]} />
          </Field>
          <Field>
            <FieldLabel>Rol</FieldLabel>
            <Controller
              name="role"
              control={form.control}
              render={({ field }) => (
                <Choice
                  label="Rol invitado"
                  items={labels}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </Field>
          <Button type="submit" disabled={form.formState.isSubmitting || busy}>
            Crear acceso
          </Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Acceso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <p>{member.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.username}
                  </p>
                </TableCell>
                <TableCell>
                  {member.role === 'owner' ? (
                    <Badge>Administrador</Badge>
                  ) : (
                    <Choice
                      label={`Rol de ${member.name}`}
                      items={labels}
                      value={member.role}
                      onChange={(role) => {
                        if (!busy)
                          void action(
                            `/venues/${venueId}/members/${member.id}`,
                            'PATCH',
                            { role, active: !!member.active },
                          )
                      }}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {member.role === 'owner' ? (
                    'Activo'
                  ) : (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          `/venues/${venueId}/members/${member.id}`,
                          'PATCH',
                          { role: member.role, active: !member.active },
                        )
                      }
                    >
                      {member.active ? 'Revocar acceso' : 'Restaurar acceso'}
                    </Button>
                  )}
                  <PasswordReset
                    venueId={venueId}
                    userId={member.id}
                    name={member.name}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
