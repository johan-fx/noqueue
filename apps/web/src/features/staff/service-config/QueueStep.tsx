import type { UseFormReturn } from 'react-hook-form'
import type { ServiceInput } from '@noqueue/contracts/staff'
import { Settings2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

export function QueueStep({
  form,
  onConfigure,
}: {
  form: UseFormReturn<ServiceInput>
  onConfigure?: () => void
}) {
  const type = form.watch('type')
  const automaticAssignmentEnabled = form.watch('automaticAssignmentEnabled')
  const fields = [
    [
      'averageMinutes',
      'Intervalo inicial estimado entre turnos (minutos)',
    ],
    [
      'capacity',
      type === 'pool'
        ? 'Nº máximo de personas en lista'
        : 'Nº máximo de turnos en lista',
    ],
  ] as const
  return (
    <div className="space-y-6">
      {/* Edited directly on the main form, not in Configuración avanzada. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <FieldLabel
            htmlFor="automatic-assignment-enabled"
            className="text-base"
          >
            Modo de gestión automática
          </FieldLabel>  
        
          <Switch
            id="automatic-assignment-enabled"
            aria-label="Modo de gestión automática"
            checked={automaticAssignmentEnabled ?? false}
            onCheckedChange={(checked) =>
              form.setValue('automaticAssignmentEnabled', checked, {
                shouldDirty: true,
              })
            }
            className="mt-0.5"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          El sistema avisará al siguiente cliente compatible. Si no se confirma su llegada dentro del plazo, cancelará su turno y avisará al siguiente. El personal solo tendrá que intervenir
          en casos excepcionales.
        </p>
      </div>
      {onConfigure && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-gray-500"
          onClick={onConfigure}
        >
          <Settings2Icon aria-hidden="true" /> Configuración avanzada
        </Button>
      )}
      {fields.map(([name, label]) => (
        <Field key={name}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            type="number"
            min={1}
            {...form.register(name, { valueAsNumber: true })}
          />
          <FieldError errors={[form.formState.errors[name]]} />
        </Field>
      ))}
      <p className="text-sm text-muted-foreground">
        El estimador aprende y ajusta este intervalo según el ritmo real de
        asignación de turnos.
      </p>
      <p className="text-sm text-muted-foreground">
        Los umbrales de acercamiento, los avisos de cambios de estimación y el
        plazo de llegada se ajustan en Configuración avanzada.
      </p>
    </div>
  )
}
