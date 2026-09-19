export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const messages: Record<string, string> = {
  unauthorized: 'Tu sesión ha caducado. Vuelve a entrar.',
  forbidden: 'No tienes permiso para esta acción.',
  not_found: 'No se ha encontrado el recurso.',
  version_conflict:
    'Otra persona ha modificado la cola. Actualiza antes de continuar.',
  invalid_transition: 'El turno ya ha cambiado de estado.',
  arrival_grace_active: 'Todavía no ha terminado el tiempo de llegada.',
  rate_limited: 'Demasiados intentos. Espera un minuto.',
  username_unavailable:
    'Ese usuario ya existe. Elige otro; no se modifica una cuenta existente.',
  password_reset_forbidden:
    'No puedes restablecer esta cuenta. Contacta con NoQueue.',
  slug_unavailable: 'Ese identificador ya está en uso.',
  invitation_unavailable:
    'La invitación ha caducado, se ha cancelado o pertenece a otro email.',
  member_exists:
    'Esta persona ya tiene acceso. Modifica su acceso en la tabla.',
  temporarily_unavailable:
    'Servicio temporalmente no disponible. Inténtalo de nuevo.',
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`/api/v1/staff${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json()
  if (!response.ok)
    throw new ApiError(
      response.status,
      messages[data.error as string] ??
        'No se ha podido completar la operación.',
    )
  return data as T
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'No se ha podido completar la operación.'
