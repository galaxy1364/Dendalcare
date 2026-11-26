import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeTable, type TableDataStatus } from '@/lib/useRealtimeTable';
import { rawSupabase } from '@/lib/supabaseCore';
import { getCurrentJalaliMonthBounds, todayGregorian } from '@/lib/jalali';
import { getActiveClinicUser } from '@/lib/cloudSyncEngine';
import { ACTIVE_TENANT_ID, getActiveBranchId, getActiveTenantId } from '@/services/authentication/authService';
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
import type {
  DashboardAggregateStatus,
  DashboardServerSummary,
  DashboardSourceKey,
} from './dashboard.types';

/**
 * V4 Engineering Release Gate — Data Minimization & Full-Dataset Accuracy:
 * - Zero `phone` (PII) projected on Dashboard patients query
 * - Accounting realization & reversal dates (`performed_at, completed_at, cancelled_at`,
 *   `refunded_at, voided_at, reversed_payment_id`) explicitly projected
 * - Server-side RPC `get_clinic_dashboard_summary` wired as primary aggregate source
 * - Client hooks use `fetchAllPages: true` with explicit truncation (`partial`) detection
 */
export const DASHBOARD_SELECTS = {
  patients: 'id,tenant_id,branch_id,first_name,last_name,created_at',
  appointments:
    'id,tenant_id,branch_id,patient_id,staff_id,title,appointment_date,appointment_time,duration_min,type,status,created_at',
  treatments:
    'id,tenant_id,branch_id,patient_id,status,total_cost,paid_amount,discount,doctor_cost,lab_cost,material_cost,other_cost,performed_at,completed_at,cancelled_at,created_at',
  lab_orders:
    'id,tenant_id,branch_id,patient_id,lab_name,tooth_numbers,status,due_date,received_date,sent_date,created_at',
  implants:
    'id,tenant_id,branch_id,patient_id,tooth_number,brand,stage,placement_date,osseointegration_date,abutment_date,crown_date,created_at',
  payments:
    'id,tenant_id,branch_id,patient_id,treatment_id,amount,payment_date,status,refunded_at,voided_at,reversed_payment_id,created_at',
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

const DASHBOARD_PAGE_OPTIONS = {
  limit: 500,
  offset: 0,
  fetchAllPages: true,
  maxPages: 20,
} as const;

/**
 * Pure status aggregator (exported for production-import testing).
 * Evaluates each data source independently so partial truncation, locked offline vault,
 * unauthorized access, or missing schema migration is surfaced transparently and gates financial KPIs.
 */
export function evaluateDashboardSourceStatuses(
  sourceStatuses: Record<DashboardSourceKey, TableDataStatus>,
  meta: {
    isStale: boolean;
    isLoading: boolean;
    errorMessage: string | null;
    serverSummaryValid?: boolean;
  }
): DashboardAggregateStatus {
  const keys = Object.keys(sourceStatuses) as DashboardSourceKey[];
  const statuses = keys.map((k) => sourceStatuses[k]);

  const migrationRequiredTables = keys.filter((k) => sourceStatuses[k] === 'migration_required');
  const truncatedSources = keys.filter((k) => sourceStatuses[k] === 'partial');
  const lockedOfflineTables = keys.filter((k) => sourceStatuses[k] === 'locked_offline');
  const incompleteSources = keys.filter((k) => {
    const st = sourceStatuses[k];
    return (
      st === 'error' ||
      st === 'timeout' ||
      st === 'unauthorized' ||
      st === 'migration_required' ||
      st === 'loading' ||
      st === 'partial' ||
      st === 'locked_offline'
    );
  });

  const serverSummaryValid = Boolean(meta.serverSummaryValid);
  const clientFinancialComplete = FINANCIAL_REQUIRED_SOURCES.every((k) => {
    const st = sourceStatuses[k];
    return st === 'ready' || st === 'empty';
  });

  const financialDataComplete = serverSummaryValid || clientFinancialComplete;

  const hasMigration = migrationRequiredTables.length > 0;
  const hasUnauthorized = statuses.some((s) => s === 'unauthorized');
  const hasLockedOffline = lockedOfflineTables.length > 0;
  const hasOffline = statuses.some((s) => s === 'offline');
  const hasTimeout = statuses.some((s) => s === 'timeout');
  const hasError = statuses.some((s) => s === 'error');
  const hasPartial = truncatedSources.length > 0 && !serverSummaryValid;
  const anyReady = statuses.some((s) => s === 'ready');

  let overall: TableDataStatus = 'ready';
  if (hasMigration) overall = 'migration_required';
  else if (hasUnauthorized) overall = 'unauthorized';
  else if (hasLockedOffline) overall = 'locked_offline';
  else if (hasOffline) overall = 'offline';
  else if (hasTimeout && !hasError) overall = 'timeout';
  else if (hasError) overall = 'error';
  else if (hasPartial) overall = 'partial';
  else if (meta.isLoading && !anyReady && !serverSummaryValid) overall = 'loading';
  else if (!anyReady && !serverSummaryValid && statuses.every((s) => s === 'empty')) overall = 'empty';

  return {
    overall,
    isStale: meta.isStale,
    isLoading: meta.isLoading,
    errorMessage: meta.errorMessage,
    sourceStatuses,
    incompleteSources,
    truncatedSources,
    lockedOfflineTables,
    migrationRequiredTables,
    financialDataComplete,
    dataSourceMode: serverSummaryValid ? 'server_rpc' : 'client_paginated',
  };
}

export function isValidDashboardServerSummary(
  raw: unknown,
  expectedTenantId: string,
  expectedBranchId: string
): raw is DashboardServerSummary {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.tenant_id !== 'string' || typeof obj.branch_id !== 'string') return false;
  if (obj.tenant_id.trim() !== expectedTenantId.trim()) return false;
  if (obj.branch_id.trim() !== expectedBranchId.trim()) return false;
  if (typeof obj.month_collected !== 'number' || typeof obj.month_net_profit !== 'number') {
    return false;
  }
  return true;
}

const RPC_SUMMARY_TIMEOUT_MS = 5000;

/**
 * Authoritative server-side aggregation RPC for clinics of any size (>500 monthly records).
 * Validates returned tenant_id & branch_id strictly (fail-closed) with a bounded timeout
 * and returns null gracefully if the RPC function is not deployed or times out.
 */
export async function fetchDashboardServerSummary(params: {
  tenantId: string;
  branchId: string;
  todayIso: string;
  monthStartIso: string;
  monthEndIso: string;
  timeoutMs?: number;
}): Promise<DashboardServerSummary | null> {
  if (!params.tenantId?.trim() || !params.branchId?.trim()) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const rpcFn = (rawSupabase as any).rpc;
    if (typeof rpcFn !== 'function') return null;

    const rpcCall = Promise.resolve(
      rpcFn.call(rawSupabase, 'get_clinic_dashboard_summary', {
        p_tenant_id: params.tenantId.trim(),
        p_branch_id: params.branchId.trim(),
        p_today_iso: params.todayIso,
        p_month_start: params.monthStartIso,
        p_month_end: params.monthEndIso,
      })
    );

    const timeoutGuard = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), params.timeoutMs ?? RPC_SUMMARY_TIMEOUT_MS);
    });

    const outcome = await Promise.race([rpcCall, timeoutGuard]);
    if (!outcome || typeof outcome !== 'object') return null;
    const { data, error } = outcome as { data?: unknown; error?: unknown };
    if (error || !data) return null;
    return isValidDashboardServerSummary(data, params.tenantId, params.branchId) ? data : null;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export interface DashboardRefreshSummary {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  failedKeys: string[];
}

export async function runSettledDashboardRefresh(
  tasks: Array<{ key: string; run: () => Promise<unknown> }>
): Promise<DashboardRefreshSummary> {
  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const failedKeys: string[] = [];
  let succeeded = 0;

  settled.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      succeeded += 1;
    } else {
      failedKeys.push(tasks[idx].key);
    }
  });

  return {
    ok: failedKeys.length === 0,
    total: tasks.length,
    succeeded,
    failed: failedKeys.length,
    failedKeys,
  };
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

  const [serverSummary, setServerSummary] = useState<DashboardServerSummary | null>(null);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const rpcGenRef = useRef(0);

  const loadServerSummary = useCallback(async () => {
    const gen = ++rpcGenRef.current;
    const activeUser = getActiveClinicUser();
    const tenantId = getActiveTenantId() || activeUser.tenantId || ACTIVE_TENANT_ID;
    const branchId = getActiveBranchId();
    const todayIso = todayGregorian();
    const bounds = getCurrentJalaliMonthBounds(todayIso);
    const summary = await fetchDashboardServerSummary({
      tenantId,
      branchId,
      todayIso,
      monthStartIso: bounds.startGregorian,
      monthEndIso: bounds.endGregorian,
    });
    if (gen === rpcGenRef.current) {
      setServerSummary(summary);
    }
  }, []);

  useEffect(() => {
    void loadServerSummary();
    const onScopeChange = () => {
      rpcGenRef.current += 1;
      setServerSummary(null);
      setScopeEpoch((e) => e + 1);
    };
    window.addEventListener('minadental-user-changed', onScopeChange);
    window.addEventListener('minadental-branch-changed', onScopeChange);
    window.addEventListener('minadental-auth-changed', onScopeChange);
    return () => {
      window.removeEventListener('minadental-user-changed', onScopeChange);
      window.removeEventListener('minadental-branch-changed', onScopeChange);
      window.removeEventListener('minadental-auth-changed', onScopeChange);
    };
  }, [loadServerSummary, scopeEpoch]);

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
    allHooks.find((h) => h.status === 'unauthorized')?.error ||
    allHooks.find((h) => h.status === 'locked_offline')?.error ||
    allHooks.find((h) => h.status === 'timeout')?.error ||
    allHooks.find((h) => h.status === 'partial')?.error ||
    allHooks.find((h) => h.status === 'error')?.error ||
    null;

  const status = evaluateDashboardSourceStatuses(sourceStatuses, {
    isStale,
    isLoading,
    errorMessage: firstError,
    serverSummaryValid: serverSummary !== null,
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
    serverSummary,
    status,
    refreshAll: async (): Promise<DashboardRefreshSummary> =>
      runSettledDashboardRefresh([
        { key: 'rpc_summary', run: () => loadServerSummary() },
        { key: 'patients', run: () => patients.refresh() },
        { key: 'appointments', run: () => appointments.refresh() },
        { key: 'treatments', run: () => treatments.refresh() },
        { key: 'lab_orders', run: () => labOrders.refresh() },
        { key: 'implants', run: () => implants.refresh() },
        { key: 'payments', run: () => payments.refresh() },
        { key: 'inventory', run: () => inventory.refresh() },
        { key: 'reminders', run: () => reminders.refresh() },
        { key: 'finance_transactions', run: () => finance.refresh() },
        { key: 'installments', run: () => installments.refresh() },
        { key: 'checks', run: () => checks.refresh() },
        { key: 'safteh', run: () => safteh.refresh() },
        { key: 'clinic_settings', run: () => clinicSettings.refresh() },
        { key: 'staff', run: () => staff.refresh() },
      ]),
  };
}
