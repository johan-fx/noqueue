export class ApiError extends Error {
  status: number
  retryAfter: number
  readonly code: string | undefined
  constructor(status: number, message: string, retryAfter = 0, code?: string) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
    this.code = code
  }
}
const messages: Record<string, string> = {
  location_confirmation_invalid:
    'La dirección no está confirmada o la selección ha caducado. Busca y confirma de nuevo.',
  location_provider_unavailable:
    'No se puede resolver la dirección ahora. Conservamos tus datos; inténtalo de nuevo.',
  invalid_location: 'Revisa la dirección y confirma un resultado preciso.',
  venue_version_conflict:
    'Otra persona ha modificado la ubicación. Actualiza la versión y revisa antes de guardar.',
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
  queue_unavailable: 'La lista está cerrada, completa o fuera de horario.',
  operation_retired:
    'Esta operación ya no se utiliza. Gestiona directamente los turnos de la lista.',
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
    'Usa el control de apertura o cierre para cambiar el estado de la lista.',
  close_before_topology_change:
    'Cierra la lista antes de cambiar la distribución de recursos.',
  unauthorized: 'Tu sesión ha caducado. Vuelve a entrar.',
  forbidden: 'No tienes permiso para esta acción.',
  not_found: 'No se ha encontrado el recurso.',
  version_conflict:
    'Otra persona ha modificado la lista. Actualiza antes de continuar.',
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
  legacy_arrival_deadline:
    'Resuelve los turnos asignados antiguos antes de cambiar el plazo de llegada. Puedes guardar los demás ajustes.',
  assignment_context_changed: 'El turno ha cambiado. Revisa los datos antes de asignar.',
  assignment_seating_changed: 'El espacio o la capacidad ya no son válidos. Revisa la selección.',
  invalid_assignment_seating: 'La selección de mesa solo está disponible al asignar un turno de restaurante.',
  unsupported_action:
    'Esta acción no está disponible para este servicio y estado.',
  queue_empty: 'No hay personas en espera.',
  arrival_grace_active: 'Todavía no ha terminado el tiempo de llegada.',
  rate_limited: 'Demasiados intentos. Espera un minuto.',
  username_unavailable:
    'Ese usuario ya existe. Elige otro; no se modifica una cuenta existente.',
  logo_too_large: 'El logotipo supera el tamaño máximo de 5 MB.',
  invalid_logo: 'No se puede leer la imagen: el archivo está dañado o su contenido no coincide con el formato PNG, JPG o SVG.',
  venue_logos_disabled:
    'La subida de logotipos no está disponible temporalmente. El establecimiento se conserva y podrás añadir su logo más adelante.',
  logo_dimensions_exceeded:
    'La imagen supera el límite de 8 megapíxeles o 16.384 píxeles por lado. Reduce su resolución y vuelve a intentarlo.',
  logo_image_memory_limit:
    'La imagen necesita demasiada memoria para procesarla con seguridad. Exporta una copia de menor resolución o de 8 bits e inténtalo de nuevo.',
  logo_image_complexity_limit:
    'El PNG contiene demasiados bloques de datos o metadatos. Exporta una nueva copia en PNG o JPG y vuelve a intentarlo.',
  logo_image_unsupported:
    'Esta variante de PNG no es compatible. Exporta un PNG estático de 8 bits, sin entrelazado ni metadatos de texto comprimidos, o un JPG.',
  logo_processing_busy:
    'Se está procesando otra imagen. Espera unos segundos y vuelve a guardar; el logotipo anterior no ha cambiado.',
  logo_svg_text_requires_paths:
    'Convierte el texto del SVG a trazados o sube un PNG/JPG.',
  logo_version_conflict:
    'El logotipo cambió mientras lo editabas. Revisa la versión actual antes de volver a guardar.',
  idempotency_conflict:
    'La operación no coincide con el intento anterior. Actualiza el estado antes de volver a intentarlo.',
  member_details_forbidden:
    'No puedes editar esta cuenta. Contacta con NoQueue.',
  invalid_member: 'Revisa los datos del usuario.',
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
  signal?: AbortSignal,
): Promise<T> {
  const isFormData =
    typeof FormData !== 'undefined' && body instanceof FormData
  const response = await fetch(`/api/v1/staff${path}`, {
    method,
    ...(signal ? { signal } : {}),
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: isFormData ? body : JSON.stringify(body) }),
  })
  let data: Record<string, unknown>
  try {
    const parsed: unknown = await response.json()
    data =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {}
  } catch {
    throw new ApiError(
      response.status,
      messages.temporarily_unavailable!,
      Math.max(0, Number(response.headers.get('Retry-After')) || 0),
      'temporarily_unavailable',
    )
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      messages[data.error as string] ??
        'No se ha podido completar la operación.',
      Math.max(0, Number(response.headers.get('Retry-After')) || 0),
      typeof data.error === 'string' ? data.error : undefined,
    )
  return data as T
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'No se ha podido completar la operación.'
