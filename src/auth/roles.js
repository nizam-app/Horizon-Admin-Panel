export const ROLES = ['admin', 'super_admin'];

export function isKnownStaffRole(role) {
  return ROLES.includes(role);
}

export function canWriteClaims(role) {
  return role === 'admin' || role === 'super_admin';
}

export function canManageAttendance(role) {
  return role === 'admin' || role === 'super_admin';
}

export function canViewParts(role) {
  return role === 'admin' || role === 'super_admin';
}

export function canUpdatePartStatusInvoice(role) {
  return canViewParts(role);
}

export function canAddParts(role) {
  return canViewParts(role);
}

export function canEditPartLines(role) {
  return canViewParts(role);
}

export function canManagePartsCrud(role) {
  return role === 'super_admin';
}

export function workspaceRoleLabel(role) {
  if (role === 'super_admin') return 'Super Administrator';
  return 'Administrator';
}

export const ROLE_OPTIONS = [
  { id: 'admin', label: 'Administrator' },
  { id: 'super_admin', label: 'Super Administrator' },
];
