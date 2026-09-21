import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Check } from 'lucide-react'
import { spacePresets } from './model'

export function AddSpaceStep({
  type,
  onAdd,
}: {
  type: 'restaurant' | 'pool'
  onAdd: (name: string) => void
}) {
  const presets = spacePresets[type]
  const [preset, setPreset] = useState(presets[0] ?? '')
  const [name, setName] = useState(presets[0] ?? '')
  return (
    <form
      id="add-space"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim().length >= 2) onAdd(name.trim())
      }}
    >
      <Field>
        <FieldLabel>Espacio predefinido</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {presets.map((item) => {
            const selected = preset === item
            return (
              <Button
                key={item}
                type="button"
                variant="outline"
                aria-pressed={selected}
                className="justify-between"
                onClick={() => {
                  setPreset(item)
                  setName(item)
                }}
              >
                {item}
                {selected && <Check aria-hidden="true" />}
              </Button>
            )
          })}
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor="space-name">Nombre del espacio</FieldLabel>
        <Input
          id="space-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
    </form>
  )
}
