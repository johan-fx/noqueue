import { useState } from 'react'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
export function ProfileForm<T extends FieldValues>({
  title,
  description,
  form,
  fields,
  submit,
  success = 'Cambios guardados.',
}: {
  title: string
  description?: string
  form: UseFormReturn<T>
  fields: [Path<T>, string, string][]
  submit: (values: T) => Promise<void>
  success?: string
}) {
  const [notice, setNotice] = useState(''),
    [error, setError] = useState('')
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setNotice('')
            setError('')
            try {
              await submit(values)
              setNotice(success)
            } catch {
              setError(
                'No se pudo guardar. Comprueba los datos. Si tu sesión no es reciente, vuelve a entrar; para problemas con el email contacta con NoQueue.',
              )
            }
          })}
        >
          {fields.map(([name, label, type]) => (
            <Field key={name}>
              <FieldLabel htmlFor={name}>{label}</FieldLabel>
              <Input
                id={name}
                type={type}
                autoComplete={
                  type === 'password'
                    ? name === 'currentPassword'
                      ? 'current-password'
                      : 'new-password'
                    : type === 'email'
                      ? 'email'
                      : 'name'
                }
                {...form.register(name)}
                aria-invalid={!!form.formState.errors[name]}
              />
              <FieldError
                errors={[
                  form.formState.errors[name] as
                    | { message?: string }
                    | undefined,
                ]}
              />
            </Field>
          ))}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Guardar cambios
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
