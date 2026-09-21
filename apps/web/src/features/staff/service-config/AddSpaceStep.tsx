import { useState, type ReactNode } from 'react'
import { Check, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { spacePresets } from './model'

// Nested drawer: the capacity step stays mounted and stacks behind this panel.
export function AddSpaceDrawer({
  open,
  type,
  onOpenChange,
  onAdd,
  children,
}: {
  open: boolean
  type: 'restaurant' | 'pool'
  onOpenChange: (open: boolean) => void
  onAdd: (name: string) => void
  children: ReactNode
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      {children}
      <DrawerContent className="w-full sm:w-[28rem]">
        <DrawerHeader className="gap-4 border-b p-6">
          <div className="flex items-center gap-2">
            <DrawerClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Volver"
                />
              }
            >
              <ChevronLeft aria-hidden="true" />
            </DrawerClose>
            <div>
              <DrawerTitle className="text-xl">Añadir nuevo espacio</DrawerTitle>
              <DrawerDescription>Capacidad</DrawerDescription>
            </div>
          </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          {/* Remount so the name field starts from the first preset each time. */}
          {open && <AddSpaceStep key="open" type={type} onAdd={onAdd} />}
        </div>
        <DrawerFooter className="border-t bg-background p-4">
          <Button type="submit" form="add-space" className="h-12 w-full">
            Añadir
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

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
