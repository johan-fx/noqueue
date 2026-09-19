// Adapted from Better Auth UI's ChangeEmail (MIT); RHF + Zod form binding.
import { useAuth, useSession, useChangeEmail } from '@better-auth-ui/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ProfileForm } from '../../profile-form'
const schema = z.object({
  email: z
    .email()
    .refine(
      (v) => !v.toLowerCase().endsWith('.invalid'),
      'Introduce un email real',
    ),
})
export function ChangeEmail() {
  const { authClient } = useAuth()
  const { data: session } = useSession(authClient)
  const mutation = useChangeEmail(authClient)
  const form = useForm({
    resolver: zodResolver(schema),
    values: { email: session?.user.email ?? '' },
  })
  return (
    <ProfileForm
      title="Cambiar email"
      description="La dirección actual no cambia hasta verificar el enlace enviado al nuevo email. No necesitas acceder al email ficticio."
      success="Revisa el nuevo email para confirmar el cambio. Si no llega, comprueba la dirección o contacta con NoQueue."
      form={form}
      fields={[['email', 'Email', 'email']]}
      submit={async (values) => {
        await mutation.mutateAsync({
          newEmail: values.email,
          callbackURL: '/settings/account',
        })
      }}
    />
  )
}
