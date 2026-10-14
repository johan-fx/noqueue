import {
  inviteSchema,
  type Capability,
  type StaffRole,
} from '@noqueue/contracts/staff'

export const roleInformation: Record<StaffRole, { label: string; summary: string }> = {
  owner: {
    label: 'Administrador',
    summary:
      'Gestiona los servicios, las listas y los accesos del establecimiento.',
  },
  venue_manager: {
    label: 'Responsable de zona',
    summary: 'Configura los servicios y coordina la atención de las listas.',
  },
  queue_staff: {
    label: 'Personal de lista',
    summary:
      'Consulta y gestiona solo los servicios asignados, sin cambiar la configuración.',
  },
  viewer: {
    label: 'Solo lectura',
    summary: 'Consulta los servicios y las listas sin modificar datos.',
  },
}
export const capabilityLabels: Record<Capability, string> = {
  'queue.read': 'Consultar servicios y listas',
  'queue.operate': 'Añadir y gestionar turnos',
  'queue.configure': 'Configurar servicios y listas',
  'members.manage': 'Gestionar accesos de usuarios',
  'metrics.read': 'Consultar métricas del establecimiento',
}
export const memberRoleLabels = Object.fromEntries(
  inviteSchema.shape.role.options.map((role) => [
    role,
    roleInformation[role].label,
  ]),
) as Record<(typeof inviteSchema.shape.role.options)[number], string>
