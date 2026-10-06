export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const messages: Record<string, string> = {
  restore_reason_required: 'Indica un motivo para restaurar el turno.',
  active_approach_confirmation_required:
    'Confirma la aplicación de los umbrales a los turnos en espera.',
  whatsapp_consent_required:
    'El cliente debe facilitar su teléfono y consentir los avisos de WhatsApp.',
  whatsapp_unavailable:
    'Los avisos de WhatsApp no están disponibles. Contacta con la administración.',
  invalid_join: 'Revisa los datos del turno.',
  invalid_reception_service:
    'El tipo de gestión no está disponible en este servicio.',
  invalid_space_preference:
    'El espacio no existe o no tiene capacidad para este grupo.',
  preferred_space_in_use:
    'Hay turnos activos que han elegido ese espacio. Resuélvelos antes de cambiarlo.',
  queue_unavailable: 'La cola está cerrada, completa o fuera de horario.',
  inventory_refresh_required:
    'La distribución ha cambiado. Confirma de nuevo la ocupación antes de llamar más turnos. Las llegadas y liberaciones siguen disponibles.',
  inventory_already_confirmed:
    'La ocupación ya está confirmada. Usa Actualizar ocupación para corregirla con un motivo.',
  configuration_missing:
    'Configura los tipos de mesa o grupos de plazas antes de confirmar la ocupación.',
  incomplete_inventory: 'Confirma la ocupación de todos los grupos.',
  invalid_inventory:
    'Revisa los recuentos: no pueden superar los recursos disponibles.',
  lifecycle_command_required:
    'Usa el control de apertura o cierre para cambiar el estado de la cola.',
  close_before_topology_change:
    'Cierra la cola antes de cambiar la distribución de recursos.',
  unauthorized: 'Tu sesión ha caducado. Vuelve a entrar.',
  forbidden: 'No tienes permiso para esta acción.',
  not_found: 'No se ha encontrado el recurso.',
  version_conflict:
    'Otra persona ha modificado la cola. Actualiza antes de continuar.',
  invalid_transition: 'El turno ya ha cambiado de estado.',
  no_free_compatible_resource:
    'No hay un recurso compatible libre. Confirma las liberaciones y actualiza.',
  oldest_compatible_required:
    'Corresponde llamar al turno compatible más antiguo. Para una excepción, indica el motivo.',
  occupancy_not_empty:
    'Resuelve las llamadas y libera los turnos en servicio antes de confirmar que el servicio está vacío.',
  untracked_occupancy:
    'Hay turnos en servicio sin recurso registrado. Finalízalos antes de activar el motor.',
  occupied_resource_configuration:
    'No se puede quitar o cambiar un recurso ocupado. Libéralo primero.',
  drain_resources_before_deactivation:
    'Libera todos los recursos antes de desactivar el motor.',
  invalid_adjustment:
    'Revisa el grupo y la caducidad del ajuste: debe estar entre ahora y las próximas 24 horas.',
  operational_initialization_required:
    'Inicializa los recursos desde la cuenta del establecimiento después de crear el servicio.',
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
