import { useState } from 'react'
import { Check, Info, Minus, X } from 'lucide-react'
import {
  capabilities,
  roleCapabilities,
  type StaffRole,
} from '@noqueue/contracts/staff'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from '@/components/ui/popover'
import { capabilityLabels, roleInformation } from './member-model'

export function RoleHelpPopover({
  role,
  trigger = 'text',
  disabled = false,
  revoked = false,
  label,
}: {
  role: StaffRole
  trigger?: 'text' | 'icon'
  disabled?: boolean
  revoked?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  // Reset this instance rather than hiding an open state that could reappear
  // when a request finishes or its nested action drawer closes.
  if (disabled && open) setOpen(false)
  const info = roleInformation[role],
    allowed = roleCapabilities[role],
    excluded = capabilities.filter(
      (capability) => !allowed.includes(capability),
    )
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={trigger === 'icon' ? 'icon' : 'default'}
            className={
              trigger === 'icon' ? 'size-10 shrink-0' : 'min-h-10 px-2'
            }
            disabled={disabled}
            aria-label={label ?? `Ver permisos de ${info.label}`}
          />
        }
      >
        <Info aria-hidden="true" className="size-4" />
        {trigger === 'text' && 'Ver permisos'}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(var(--available-height),calc(100dvh-2rem))] w-80 overflow-y-auto overscroll-contain"
        finalFocus={disabled ? false : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <PopoverTitle>Permisos · {info.label}</PopoverTitle>
          <PopoverClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0"
                aria-label="Cerrar ayuda de permisos"
              />
            }
          >
            <X aria-hidden="true" />
          </PopoverClose>
        </div>
        <PopoverDescription>{info.summary}</PopoverDescription>
        <div className="mt-4 space-y-4">
          <section>
            <h3 className="mb-2 font-medium">Puede hacer</h3>
            <ul aria-label="Puede hacer" className="space-y-2">
              {allowed.map((capability) => (
                <li key={capability} className="flex items-start gap-2">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>{capabilityLabels[capability]}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 font-medium">No incluye</h3>
            {excluded.length ? (
              <ul aria-label="No incluye" className="space-y-2">
                {excluded.map((capability) => (
                  <li
                    key={capability}
                    className="flex items-start gap-2 text-muted-foreground"
                  >
                    <Minus
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span>{capabilityLabels[capability]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                Este rol incluye todas las operaciones del establecimiento.
              </p>
            )}
          </section>
          <p className="text-xs text-muted-foreground">
            Los permisos se aplican solo a este establecimiento. La gestión de
            usuarios mantiene las restricciones de las cuentas protegidas,
            globales o compartidas.
          </p>
          {revoked && (
            <p className="rounded-md bg-muted p-3 text-sm">
              Acceso revocado: este usuario no puede acceder hasta que se
              restaure su acceso.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
