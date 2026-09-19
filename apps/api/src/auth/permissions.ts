import { createAccessControl } from 'better-auth/plugins/access'
import {
  roleCapabilities,
  type StaffRole,
  type Capability,
} from '@noqueue/contracts/staff'
export const ac = createAccessControl({
  queue: ['read', 'operate', 'configure'],
  members: ['manage'],
} as const)
export const roles = {
  owner: ac.newRole({
    queue: ['read', 'operate', 'configure'],
    members: ['manage'],
  }),
  venue_manager: ac.newRole({ queue: ['read', 'operate', 'configure'] }),
  queue_staff: ac.newRole({ queue: ['read', 'operate'] }),
  viewer: ac.newRole({ queue: ['read'] }),
  member: ac.newRole({}),
}
export function permits(role: string, permission: Capability) {
  return (roleCapabilities[role as StaffRole] ?? []).includes(permission)
}
export function isCommercial(role: string | null | undefined) {
  return role === 'commercial_operator' || role === 'platform_admin'
}
