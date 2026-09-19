import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { joinedEntrySchema } from '@noqueue/contracts/queue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
const schema = z.object({ partySize: z.number().int().min(1).max(20) })
export function PublicQueue() {
  const { queueId } = useParams(),
    navigate = useNavigate(),
    [service, setService] = useState<{
      name: string
      venueName: string
      open: number
    } | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState<{ body: string; key: string } | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { partySize: 2 },
  })
  useEffect(() => {
    fetch(`/api/v1/public/services/${queueId}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error()
        setService(await r.json())
      })
      .catch(() => setError('Este servicio no está disponible.'))
  }, [queueId])
  async function submit(input: z.infer<typeof schema>) {
    setError('')
    const body = JSON.stringify({ ...input, locale: 'es' }),
      current =
        attempt?.body === body ? attempt : { body, key: crypto.randomUUID() }
    setAttempt(current)
    try {
      const r = await fetch(`/api/v1/public/services/${queueId}/entries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': current.key,
        },
        body,
      })
      if (!r.ok)
        throw new Error(
          'La cola está cerrada, completa o fuera de horario. Inténtalo más tarde.',
        )
      const entry = joinedEntrySchema.parse(await r.json())
      navigate(`/t/${entry.recoveryToken}?lang=es`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
    }
  }
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <p className="text-sm text-muted-foreground">{service?.venueName}</p>
        <CardTitle>{service?.name ?? 'Cola'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={form.handleSubmit(submit)}>
          <Field>
            <FieldLabel htmlFor="partySize">Número de personas</FieldLabel>
            <Input
              id="partySize"
              type="number"
              min={1}
              max={20}
              {...form.register('partySize', { valueAsNumber: true })}
            />
            <FieldError errors={[form.formState.errors.partySize]} />
          </Field>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            No necesitas cuenta. Conserva la página de tu turno para consultar
            su estado.
          </p>
          <Button
            type="submit"
            disabled={!service?.open || form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? 'Confirmando…' : 'Unirme a la cola'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
