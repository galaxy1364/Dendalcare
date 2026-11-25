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
  patients: ['manager', 'dentist', 'secretary', 'assistant'],
  appointments: ['manager', 'dentist', 'secretary', 'assistant'],
  calendar: ['manager', 'dentist', 'secretary', 'assistant'],
  treatments: ['manager', 'dentist', 'assistant'],
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

export function resolveEffectiveRole(params: {
  serverVerifiedRole?: string | null;
  localRole?: string | null;
}): ClinicUserRole {
  if (params.serverVerifiedRole && VALID_ROLES.has(params.serverVerifiedRole as ClinicUserRole)) {
    return params.serverVerifiedRole as ClinicUserRole;
  }
  if (params.localRole && VALID_ROLES.has(params.localRole as ClinicUserRole)) {
    return params.localRole as ClinicUserRole;
  }
  return 'secretary';
}

export function canAccessRoute(role: ClinicUserRole | string | undefined, route: AppRouteId): boolean {
  const safeRole: ClinicUserRole =
    role && VALID_ROLES.has(role as ClinicUserRole) ? (role as ClinicUserRole) : 'secretary';
  const allowed = ROUTE_ALLOWED_ROLES[route];
  if (!allowed) return false;
  return allowed.includes(safeRole);
}

export function canPerformAction(
  role: ClinicUserRole | string | undefined,
  action: ClinicAction
): boolean {
  const safeRole: ClinicUserRole =
    role && VALID_ROLES.has(role as ClinicUserRole) ? (role as ClinicUserRole) : 'secretary';
  const allowed = ACTION_ALLOWED_ROLES[action];
  if (!allowed) return false;
  return allowed.includes(safeRole);
}

export function getAuthorizedRoutesForRole(role: ClinicUserRole | string | undefined): AppRouteId[] {
  return (Object.keys(ROUTE_ALLOWED_ROLES) as AppRouteId[]).filter((r) => canAccessRoute(role, r));
}
