/**
 * Authorization works with permissions; roles are only named bundles of them (ADR-0010).
 * Adding a role = adding an entry to ROLE_PERMISSIONS.
 */
export const PERMISSIONS = [
  'user.manage',
  'audit.read',
  'customer.read',
  'customer.write',
  'equipmentType.read',
  'equipmentType.write',
  'item.read',
  'item.write',
  'item.import',
  'inspection.read',
  'inspection.perform',
  'inspection.close',
  'inspection.reopen',
  'export.read',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['admin', 'inspector'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrátor',
  inspector: 'Technik',
};

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  inspector: [
    'customer.read',
    'equipmentType.read',
    'item.read',
    'item.write',
    'inspection.read',
    'inspection.perform',
    'export.read',
  ],
};

export function permissionsOf(role: Role): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
