// Adapted from Better Auth UI's ChangePassword (MIT); credential-only, RHF + Zod.
import { useAuth, useChangePassword } from '@better-auth-ui/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { passwordSchema } from '@noqueue/contracts/staff'
import { ProfileForm } from '../../profile-form'
const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  })
export function ChangePassword() {
  const { authClient } = useAuth()
  const mutation = useChangePassword(authClient)
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })
  return (
    <ProfileForm
      title="Cambiar contraseña"
      description="Es opcional. Utiliza al menos 15 caracteres. Al cambiarla se cerrarán tus otras sesiones."
      form={form}
      fields={[
        ['currentPassword', 'Contraseña actual', 'password'],
        ['newPassword', 'Nueva contraseña', 'password'],
        ['confirmPassword', 'Confirmar contraseña', 'password'],
      ]}
      submit={async (values) => {
        await mutation.mutateAsync({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
          revokeOtherSessions: true,
        })
        form.reset()
      }}
    />
  )
}
