import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { passwordSchema } from '@noqueue/contracts/staff'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { api } from './api'
const schema = z.object({ password: passwordSchema })
export function PasswordReset({
  venueId,
  userId,
  name,
}: {
  venueId: string
  userId: string
  name: string
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState('')
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '' },
  })
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setError('')
          form.reset()
          setOpen(true)
        }}
      >
        Restablecer contraseña
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restablecer acceso de {name}</DialogTitle>
            <DialogDescription>
              Verifica su identidad antes de continuar. Se cerrarán todas sus
              sesiones. Entrega la nueva contraseña por un canal seguro.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (values) => {
              try {
                await api(
                  `/venues/${venueId}/members/${userId}/password`,
                  'POST',
                  values,
                )
                form.reset()
                setOpen(false)
              } catch {
                setError(
                  'No se pudo restablecer. Puede que no tengas permiso para esta cuenta.',
                )
              }
            })}
          >
            <Field>
              <FieldLabel htmlFor="reset-password">
                Nueva contraseña (mínimo 15 caracteres)
              </FieldLabel>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
              <FieldError errors={[form.formState.errors.password]} />
            </Field>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Confirmar restablecimiento
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
