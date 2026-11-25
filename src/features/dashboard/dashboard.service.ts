import { useRealtimeTable, type TableDataStatus } from '@/lib/useRealtimeTable';
import { rawSupabase } from '@/lib/supabaseCore';
import type {
  Appointment,
  Check,
  ClinicSetting,
  FinanceTransaction,
  Implant,
  Installment,
  InventoryItem,
  LabOrder,
  Patient,
  Payment,
  Reminder,
  Safteh,
  Staff,
  Treatment,
} from '@/lib/supabase';
import type { DashboardAggregateStatus, DashboardSourceKey } from './dashboard.types';

/**
 * Third Audit FIX 02 & FIX 09:
 * - Minimal column projections strictly aligned with schema (zero select('*'))
 * - Per-source status reporting (`sourceStatuses`, `incompleteSources`, `migrationRequiredTables`)
 * - Complete `refreshAll()` refreshing ALL 14 data sources
 * - Explicit pagination limit (500) + optional server-side RPC aggregation helper
 */
export const DASHBOARD_SELECTS = {
  patients: 'id,tenant_id,branch_id,first_name,last_name,phone,created_at',
  appointments:
    'id,tenant_id,branch_id,patient_id,staff_id,title,appointment_date,appointment_time,duration_min,type,status,created_at',
  treatments:
    'id,tenant_id,branch_id,patient_id,status,total_cost,paid_amount,discount,doctor_cost,lab_cost,material_cost,other_cost,created_at',
  lab_orders:
    'id,tenant_id,branch_id,patient_id,lab_name,tooth_numbers,status,due_date,received_date,sent_date,created_at',
  implants:
    'id,tenant_id,branch_id,patient_id,tooth_number,brand,stage,placement_date,osseointegration_date,abutment_date,crown_date,created_at',
  payments: 'id,tenant_id,branch_id,patient_id,treatment_id,amount,payment_date,status,created_at',
  inventory:
    'id,tenant_id,branch_id,name,quantity,min_quantity,unit,expiry_date,reorder_quantity,created_at',
  reminders: 'id,tenant_id,branch_id,patient_id,title,reminder_date,status,priority,created_at',
  finance_transactions:
    'id,tenant_id,branch_id,payment_id,treatment_id,type,category,amount,transaction_date,patient_id,reference,description,created_at',
  installments:
    'id,tenant_id,branch_id,patient_id,treatment_id,total_amount,paid_amount,monthly_amount,total_months,paid_months,next_due_date,status,created_at',
  checks:
    'id,tenant_id,branch_id,patient_id,treatment_id,installment_id,check_number,bank_name,amount,due_date,status,is_guarantee,type,notes,created_at',
  safteh: 'id,tenant_id,branch_id,patient_id,safteh_number,guarantor_name,amount,due_date,status,created_at',
  clinic_settings: 'id,tenant_id,branch_id,key,value,category,created_at',
  staff: 'id,tenant_id,branch_id,first_name,last_name,role,active,created_at',
} as const;

export const FINANCIAL_REQUIRED_SOURCES: readonly DashboardSourceKey[] = [
  'treatments',
  'payments',
  'finance_transactions',
  'installments',
  'checks',
  'safteh',
];

const DASHBOARD_PAGE_OPTIONS = { limit: 500, offset: 0 } as const;

/**
 * Pure status aggregator (exported for Phase 14 unit testing).
 * Evaluates each data source independently so partial failure or missing schema migration
 * is surfaced transparently and financial KPIs are gated behind `financialDataComplete`.
 */
export function evaluateDashboardSourceStatuses(
  sourceStatuses: Record<DashboardSourceKey, TableDataStatus>,
  meta: { isStale: boolean; isLoading: boolean; errorMessage: string | null }
): DashboardAggregateStatus {
  const keys = Object.keys(sourceStatuses) as DashboardSourceKey[];
  const statuses = keys.map((k) => sourceStatuses[k]);

  const migrationRequiredTables = keys.filter((k) => sourceStatuses[k] === 'migration_required');
  const incompleteSources = keys.filter((k) => {
    const st = sourceStatuses[k];
    return st === 'error' || st === 'unauthorized' || st === 'migration_required' || st === 'loading';
  });

  const financialDataComplete = FINANCIAL_REQUIRED_SOURCES.every((k) => {
    const st = sourceStatuses[k];
    return st === 'ready' || st === 'empty';
  });

  const hasMigration = migrationRequiredTables.length > 0;
  const hasUnauthorized = statuses.some((s) => s === 'unauthorized');
  const hasOffline = statuses.some((s) => s === 'offline');
  const hasError = statuses.some((s) => s === 'error');
  const anyReady = statuses.some((s) => s === 'ready');

  let overall: TableDataStatus = 'ready';
  if (hasMigration) overall = 'migration_required';
  else if (hasUnauthorized) overall = 'unauthorized';
  else if (hasOffline) overall = 'offline';
  else if (hasError) overall = 'error';
  else if (meta.isLoading && !anyReady) overall = 'loading';
  else if (!anyReady && statuses.every((s) => s === 'empty')) overall = 'empty';

  return {
    overall,
    isStale: meta.isStale,
    isLoading: meta.isLoading,
    errorMessage: meta.errorMessage,
    sourceStatuses,
    incompleteSources,
    migrationRequiredTables,
    financialDataComplete,
  };
}

/**
 * Optional server-side aggregation RPC hook for high-volume clinics (>500 monthly records).
 * Returns null gracefully if the optional RPC function is not deployed yet on Supabase.
 */
export async function fetchDashboardServerSummary(params: {
  tenantId: string;
  branchId: string;
  monthStartIso: string;
  monthEndIso: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const rpcFn = (rawSupabase as any).rpc;
    if (typeof rpcFn !== 'function') return null;
    const { data, error } = await rpcFn.call(rawSupabase, 'get_clinic_dashboard_summary', {
      p_tenant_id: params.tenantId,
      p_branch_id: params.branchId,
      p_month_start: params.monthStartIso,
      p_month_end: params.monthEndIso,
    });
    if (error || !data) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function useDashboardDataSources() {
  const patients = useRealtimeTable<Patient>('patients', DASHBOARD_SELECTS.patients, null, DASHBOARD_PAGE_OPTIONS);
  const appointments = useRealtimeTable<Appointment>('appointments', DASHBOARD_SELECTS.appointments, null, DASHBOARD_PAGE_OPTIONS);
  const treatments = useRealtimeTable<Treatment>('treatments', DASHBOARD_SELECTS.treatments, null, DASHBOARD_PAGE_OPTIONS);
  const labOrders = useRealtimeTable<LabOrder>('lab_orders', DASHBOARD_SELECTS.lab_orders, null, DASHBOARD_PAGE_OPTIONS);
  const implants = useRealtimeTable<Implant>('implants', DASHBOARD_SELECTS.implants, null, DASHBOARD_PAGE_OPTIONS);
  const payments = useRealtimeTable<Payment>('payments', DASHBOARD_SELECTS.payments, null, DASHBOARD_PAGE_OPTIONS);
  const inventory = useRealtimeTable<InventoryItem>('inventory', DASHBOARD_SELECTS.inventory, null, DASHBOARD_PAGE_OPTIONS);
  const reminders = useRealtimeTable<Reminder>('reminders', DASHBOARD_SELECTS.reminders, null, DASHBOARD_PAGE_OPTIONS);
  const finance = useRealtimeTable<FinanceTransaction>('finance_transactions', DASHBOARD_SELECTS.finance_transactions, null, DASHBOARD_PAGE_OPTIONS);
  const installments = useRealtimeTable<Installment>('installments', DASHBOARD_SELECTS.installments, null, DASHBOARD_PAGE_OPTIONS);
  const checks = useRealtimeTable<Check>('checks', DASHBOARD_SELECTS.checks, null, DASHBOARD_PAGE_OPTIONS);
  const safteh = useRealtimeTable<Safteh>('safteh', DASHBOARD_SELECTS.safteh, null, DASHBOARD_PAGE_OPTIONS);
  const clinicSettings = useRealtimeTable<ClinicSetting>('clinic_settings', DASHBOARD_SELECTS.clinic_settings, null, DASHBOARD_PAGE_OPTIONS);
  const staff = useRealtimeTable<Staff>('staff', DASHBOARD_SELECTS.staff, null, DASHBOARD_PAGE_OPTIONS);

  const allHooks = [
    patients,
    appointments,
    treatments,
    labOrders,
    implants,
    payments,
    inventory,
    reminders,
    finance,
    installments,
    checks,
    safteh,
    clinicSettings,
    staff,
  ];

  const sourceStatuses: Record<DashboardSourceKey, TableDataStatus> = {
    patients: patients.status,
    appointments: appointments.status,
    treatments: treatments.status,
    lab_orders: labOrders.status,
    implants: implants.status,
    payments: payments.status,
    inventory: inventory.status,
    reminders: reminders.status,
    finance_transactions: finance.status,
    installments: installments.status,
    checks: checks.status,
    safteh: safteh.status,
    clinic_settings: clinicSettings.status,
    staff: staff.status,
  };

  const isLoading = allHooks.some((h) => h.loading);
  const isStale = allHooks.some((h) => h.isStale);
  const firstError =
    allHooks.find((h) => h.status === 'migration_required')?.error ||
    allHooks.find((h) => h.status === 'error')?.error ||
    null;

  const status = evaluateDashboardSourceStatuses(sourceStatuses, {
    isStale,
    isLoading,
    errorMessage: firstError,
  });

  return {
    patients: patients.data,
    appointments: appointments.data,
    treatments: treatments.data,
    labOrders: labOrders.data,
    implants: implants.data,
    payments: payments.data,
    inventory: inventory.data,
    reminders: reminders.data,
    finance: finance.data,
    installments: installments.data,
    checks: checks.data,
    safteh: safteh.data,
    clinicSettings: clinicSettings.data,
    staff: staff.data,
    status,
    // FIX 09: Refresh ALL 14 dashboard data sources together
    refreshAll: async () => {
      await Promise.all([
        patients.refresh(),
        appointments.refresh(),
        treatments.refresh(),
        labOrders.refresh(),
        implants.refresh(),
        payments.refresh(),
        inventory.refresh(),
        reminders.refresh(),
        finance.refresh(),
        installments.refresh(),
        checks.refresh(),
        safteh.refresh(),
        clinicSettings.refresh(),
        staff.refresh(),
      ]);
    },
  };
}
