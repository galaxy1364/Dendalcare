import type { AppRouteId } from '@/lib/navigationStack';
import type { ClinicUserRole } from '@/lib/cloudSyncEngine';

export type ClinicAction =
  | 'edit_saved_prices'
  | 'delete_critical_records'
  | 'publish_ota_update'
  | 'manage_backups'
  | 'manage_staff_shares'
  | 'view_financial_reports'
  | 'create_patient'
  | 'book_appointment'
  | 'record_treatment'
  | 'manage_inventory';

const ROUTE_ALLOWED_ROLES: Record<AppRouteId, readonly ClinicUserRole[]> = {
  dashboard: ['manager', 'dentist', 'secretary', 'assistant'],
  services: ['manager', 'dentist', 'secretary', 'assistant'],
  customize_services: ['manager', 'dentist', 'secretary', 'assistant'],
  reports: ['manager', 'dentist', 'secretary'],
  patients: ['manager', 'dentist', 'secretary', 'assistant'],
  patient_form: ['manager', 'dentist', 'secretary'],
  appointments: ['manager', 'dentist', 'secretary', 'assistant'],
  appointment_form: ['manager', 'dentist', 'secretary'],
  calendar: ['manager', 'dentist', 'secretary', 'assistant'],
  treatments: ['manager', 'dentist', 'assistant'],
  treatment_form: ['manager', 'dentist'],
  lab: ['manager', 'dentist', 'secretary', 'assistant'],
  implants: ['manager', 'dentist', 'assistant'],
  finance: ['manager', 'secretary'],
  inventory: ['manager', 'dentist', 'assistant'],
  reminders: ['manager', 'dentist', 'secretary', 'assistant'],
  staff: ['manager', 'dentist'],
  messages: ['manager', 'dentist', 'secretary', 'assistant'],
  settings: ['manager', 'dentist', 'secretary', 'assistant'],
};

const ACTION_ALLOWED_ROLES: Record<ClinicAction, readonly ClinicUserRole[]> = {
  edit_saved_prices: ['manager'],
  delete_critical_records: ['manager'],
  publish_ota_update: ['manager'],
  manage_backups: ['manager'],
  manage_staff_shares: ['manager'],
  view_financial_reports: ['manager', 'secretary'],
  create_patient: ['manager', 'dentist', 'secretary'],
  book_appointment: ['manager', 'dentist', 'secretary'],
  record_treatment: ['manager', 'dentist'],
  manage_inventory: ['manager', 'dentist', 'assistant'],
};

const VALID_ROLES = new Set<ClinicUserRole>(['manager', 'dentist', 'secretary', 'assistant']);

const ROLE_PRIVILEGE_RANK: Record<ClinicUserRole, number> = {
  assistant: 1,
  secretary: 2,
  dentist: 3,
  manager: 4,
};

export type EffectiveClinicRole = ClinicUserRole | 'unauthorized';

export function isAuthorizedRole(role: ClinicUserRole | EffectiveClinicRole | string | undefined | null): role is ClinicUserRole {
  return Boolean(role && VALID_ROLES.has(role as ClinicUserRole));
}

/**
 * V14 Strict fail-closed RBAC role resolver (zero permissive fallback):
 * - When sessionStatus is `'unauthorized'`, returns `'unauthorized'` (never `'assistant'`).
 * - When sessionStatus is `'authenticated'`, requires a verified `serverVerifiedRole` from `clinic_memberships`;
 *   if missing or invalid, returns `'unauthorized'` (never `'secretary'`). When valid, `serverVerifiedRole` is strictly authoritative
 *   so stale `localStorage` persona state can neither escalate nor silently downgrade an authenticated manager.
 * - Only allows local user switching inside `'unauthenticated'` offline/single-device workflow when a valid role is present; otherwise fails closed to `'unauthorized'`.
 */
export function resolveEffectiveRole(params: {
  serverVerifiedRole?: string | null;
  localRole?: string | null;
  sessionStatus?: 'authenticated' | 'unauthenticated' | 'unauthorized';
}): EffectiveClinicRole {
  return resolveStrictMembershipRole(params);
}

/**
 * Strict fail-closed membership resolver returning explicit `'unauthorized'` when
 * sessionStatus is `'unauthorized'` or an authenticated session lacks a verified role.
 */
export function resolveStrictMembershipRole(params: {
  serverVerifiedRole?: string | null;
  localRole?: string | null;
  sessionStatus?: 'authenticated' | 'unauthenticated' | 'unauthorized';
}): EffectiveClinicRole {
  const serverRole =
    params.serverVerifiedRole && VALID_ROLES.has(params.serverVerifiedRole as ClinicUserRole)
      ? (params.serverVerifiedRole as ClinicUserRole)
      : null;
  const localRole =
    params.localRole && VALID_ROLES.has(params.localRole as ClinicUserRole)
      ? (params.localRole as ClinicUserRole)
      : null;

  if (params.sessionStatus === 'unauthorized') {
    return 'unauthorized';
  }
  if (params.sessionStatus === 'authenticated') {
    if (!serverRole) return 'unauthorized';
    return serverRole;
  }
  if (serverRole) return serverRole;
  if (localRole) return localRole;
  return 'unauthorized';
}

export function canAccessRoute(
  role: ClinicUserRole | EffectiveClinicRole | string | undefined,
  route: AppRouteId
): boolean {
  if (!isAuthorizedRole(role)) return false;
  const allowed = ROUTE_ALLOWED_ROLES[route];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function canPerformAction(
  role: ClinicUserRole | EffectiveClinicRole | string | undefined,
  action: ClinicAction
): boolean {
  if (!isAuthorizedRole(role)) return false;
  const allowed = ACTION_ALLOWED_ROLES[action];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function getAuthorizedRoutesForRole(
  role: ClinicUserRole | EffectiveClinicRole | string | undefined
): AppRouteId[] {
  if (!isAuthorizedRole(role)) return [];
  return (Object.keys(ROUTE_ALLOWED_ROLES) as AppRouteId[]).filter((r) => canAccessRoute(role, r));
}
