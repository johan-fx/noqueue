// Adapted from Better Auth UI's ShadCN registry (MIT); RHF + Zod form binding.
import { useAuth, useSession, useUpdateUser } from '@better-auth-ui/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ProfileForm } from '../../profile-form'
const schema = z.object({ name: z.string().trim().min(2).max(100) })
export function UserProfile() {
  const { authClient } = useAuth()
  const { data: session } = useSession(authClient)
  const mutation = useUpdateUser(authClient)
  const form = useForm({
    resolver: zodResolver(schema),
    values: { name: session?.user.name ?? '' },
  })
  return (
    <ProfileForm
      title="Perfil"
      form={form}
      fields={[['name', 'Nombre', 'text']]}
      submit={async (values) => {
        await mutation.mutateAsync(values)
      }}
    />
  )
}
