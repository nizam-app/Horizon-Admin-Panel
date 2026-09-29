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

/** Employees and salaries — super_admin only (matches backend HR routes). */
export function canManageHr(role) {
  return role === 'super_admin';
}

/** Account settings workspace — super_admin only (nav); APIs are self-service for any auth user. */
export function canAccessSettings(role) {
  return role === 'super_admin';
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

/** Shorter label for the narrow sidebar (avoids harsh truncation). */
export function sidebarRoleLabel(role) {
  if (role === 'super_admin') return 'Super admin';
  return 'Administrator';
}

export const ROLE_OPTIONS = [
  { id: 'admin', label: 'Administrator' },
  { id: 'super_admin', label: 'Super Administrator' },
];
