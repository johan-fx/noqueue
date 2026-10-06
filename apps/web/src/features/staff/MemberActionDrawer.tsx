import { useState, type RefObject, type FormEvent } from 'react'
import { z } from 'zod'
import {
  inviteSchema,
  memberDetailsSchema,
  passwordSchema,
  type StaffMember,
  type MemberDetailsInput,
} from '@noqueue/contracts/staff'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronLeft } from 'lucide-react'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { memberRoleLabels } from './member-model'
export type MemberAction =
  | { kind: 'create' }
  | { kind: 'edit'; member: StaffMember }
  | { kind: 'password'; member: StaffMember }
export type MemberActionInput =
  | MemberDetailsInput
  | z.infer<typeof inviteSchema>
  | { password: string }
const passwordResetSchema = z.object({ password: passwordSchema })
export function MemberActionDrawer({
  action,
  busy,
  error,
  finalFocus,
  onClose,
  onSubmit,
}: {
  action: MemberAction
  busy: boolean
  error: string
  finalFocus: RefObject<HTMLElement | null>
  onClose: () => void
  onSubmit: (values: MemberActionInput) => Promise<void>
}) {
  const [draft, setDraft] = useState({
    name: action.kind === 'edit' ? action.member.name : '',
    username: action.kind === 'edit' ? action.member.username ?? '' : '',
    password: '',
    role:
      action.kind === 'edit'
        ? (action.member.role as MemberDetailsInput['role'])
        : ('queue_staff' as MemberDetailsInput['role']),
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const errorAttributes = (field: string) => ({
    'aria-invalid': !!errors[field],
    'aria-describedby': errors[field] ? `member-${field}-error` : undefined,
  })
  const title =
    action.kind === 'create'
      ? 'Crear usuario'
      : action.kind === 'edit'
      ? 'Editar usuario'
      : 'Restablecer contraseña'
  const submitLabel =
    action.kind === 'create'
      ? 'Crear acceso'
      : action.kind === 'edit'
      ? 'Guardar cambios'
      : 'Confirmar restablecimiento'
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const schema =
      action.kind === 'create'
        ? inviteSchema
        : action.kind === 'edit'
        ? memberDetailsSchema
        : passwordResetSchema
    const parsed = schema.safeParse(draft)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      )
      return
    }
    setErrors({})
    await onSubmit(parsed.data)
  }
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      swipeDirection="right"
    >
      <DrawerContent finalFocus={finalFocus} className="w-full sm:w-md">
        <DrawerHeader className="border-b p-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Volver"
              disabled={busy}
              onClick={onClose}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <DrawerTitle className="text-xl">{title}</DrawerTitle>
          </div>
          <DrawerDescription>
            {action.kind === 'password'
              ? 'Verifica su identidad antes de continuar. Se cerrarán todas sus sesiones. Entrega la nueva contraseña por un canal seguro.'
              : action.kind === 'edit'
              ? action.member.name
              : 'Entrega las credenciales por un canal seguro. No se comparten contraseñas.'}
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="member-action-form"
          onSubmit={(event) => void submit(event)}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6"
        >
          <fieldset disabled={busy} className="space-y-4">
            {action.kind !== 'password' && (
              <>
                <Field>
                  <FieldLabel htmlFor="member-name">Nombre</FieldLabel>
                  <Input
                    id="member-name"
                    {...errorAttributes('name')}
                    className="h-11"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                  <FieldError
                    id="member-name-error"
                    errors={errors.name ? [{ message: errors.name }] : []}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="member-username">Usuario</FieldLabel>
                  <Input
                    id="member-username"
                    {...errorAttributes('username')}
                    className="h-11"
                    autoComplete="off"
                    value={draft.username}
                    onChange={(event) =>
                      setDraft({ ...draft, username: event.target.value })
                    }
                  />
                  <FieldError
                    id="member-username-error"
                    errors={
                      errors.username ? [{ message: errors.username }] : []
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="member-role">Rol</FieldLabel>
                  <Select
                    value={draft.role}
                    disabled={busy}
                    onValueChange={(role) => {
                      if (role) setDraft({ ...draft, role })
                    }}
                  >
                    <SelectTrigger
                      id="member-role"
                      {...errorAttributes('role')}
                      className="w-full"
                    >
                      <SelectValue>{memberRoleLabels[draft.role]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(memberRoleLabels).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <FieldError
                    id="member-role-error"
                    errors={errors.role ? [{ message: errors.role }] : []}
                  />
                </Field>
              </>
            )}
            {action.kind !== 'edit' && (
              <Field>
                <FieldLabel htmlFor="member-password">
                  {action.kind === 'create'
                    ? 'Contraseña inicial (mínimo 15 caracteres)'
                    : 'Nueva contraseña (mínimo 15 caracteres)'}
                </FieldLabel>
                <Input
                  id="member-password"
                  {...errorAttributes('password')}
                  className="h-11"
                  type="password"
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(event) =>
                    setDraft({ ...draft, password: event.target.value })
                  }
                />
                <FieldError
                  id="member-password-error"
                  errors={errors.password ? [{ message: errors.password }] : []}
                />
              </Field>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </form>
        <DrawerFooter className="border-t bg-background p-6 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="member-action-form" disabled={busy}>
            {busy ? 'Guardando…' : submitLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
