import { useRealtimeTable, type TableDataStatus } from '@/lib/useRealtimeTable';
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

/**
 * Phase 02 & 09: Minimal column projections for Dashboard.
 * Strictly eliminates `select('*')` to minimize payload size and avoid leaking unnecessary PII fields.
 */
const DASHBOARD_SELECTS = {
  patients: 'id,tenant_id,branch_id,first_name,last_name,phone,created_at',
  appointments: 'id,tenant_id,branch_id,patient_id,staff_id,title,appointment_date,appointment_time,duration_min,type,status,created_at',
  treatments: 'id,tenant_id,branch_id,patient_id,status,total_cost,paid_amount,discount,doctor_cost,lab_cost,material_cost,other_cost,created_at',
  lab_orders: 'id,tenant_id,branch_id,patient_id,lab_name,tooth_numbers,status,due_date,received_date,sent_date,created_at',
  implants: 'id,tenant_id,branch_id,patient_id,tooth_number,brand,stage,placement_date,osseointegration_date,abutment_date,crown_date,created_at',
  payments: 'id,tenant_id,branch_id,patient_id,treatment_id,amount,payment_date,status,created_at',
  inventory: 'id,tenant_id,branch_id,name,quantity,min_quantity,unit,expiry_date,reorder_quantity,created_at',
  reminders: 'id,tenant_id,branch_id,patient_id,title,reminder_date,status,priority,created_at',
  finance_transactions: 'id,tenant_id,branch_id,payment_id,type,category,amount,transaction_date,patient_id,reference,description,created_at',
  installments: 'id,tenant_id,branch_id,patient_id,treatment_id,total_amount,paid_amount,monthly_amount,total_months,paid_months,next_due_date,status,created_at',
  checks: 'id,tenant_id,branch_id,patient_id,treatment_id,installment_id,check_number,bank_name,amount,due_date,status,is_guarantee,type,notes,created_at',
  safteh: 'id,tenant_id,branch_id,patient_id,safteh_number,guarantor_name,amount,due_date,status,created_at',
  clinic_settings: 'id,tenant_id,branch_id,key,value,category,created_at',
  staff: 'id,tenant_id,branch_id,first_name,last_name,role,active,created_at',
} as const;

export function useDashboardDataSources() {
  const patients = useRealtimeTable<Patient>('patients', DASHBOARD_SELECTS.patients);
  const appointments = useRealtimeTable<Appointment>('appointments', DASHBOARD_SELECTS.appointments);
  const treatments = useRealtimeTable<Treatment>('treatments', DASHBOARD_SELECTS.treatments);
  const labOrders = useRealtimeTable<LabOrder>('lab_orders', DASHBOARD_SELECTS.lab_orders);
  const implants = useRealtimeTable<Implant>('implants', DASHBOARD_SELECTS.implants);
  const payments = useRealtimeTable<Payment>('payments', DASHBOARD_SELECTS.payments);
  const inventory = useRealtimeTable<InventoryItem>('inventory', DASHBOARD_SELECTS.inventory);
  const reminders = useRealtimeTable<Reminder>('reminders', DASHBOARD_SELECTS.reminders);
  const finance = useRealtimeTable<FinanceTransaction>('finance_transactions', DASHBOARD_SELECTS.finance_transactions);
  const installments = useRealtimeTable<Installment>('installments', DASHBOARD_SELECTS.installments);
  const checks = useRealtimeTable<Check>('checks', DASHBOARD_SELECTS.checks);
  const safteh = useRealtimeTable<Safteh>('safteh', DASHBOARD_SELECTS.safteh);
  const clinicSettings = useRealtimeTable<ClinicSetting>('clinic_settings', DASHBOARD_SELECTS.clinic_settings);
  const staff = useRealtimeTable<Staff>('staff', DASHBOARD_SELECTS.staff);

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

  const isLoading = allHooks.some((h) => h.loading);
  const isStale = allHooks.some((h) => h.isStale);
  const hasUnauthorized = allHooks.some((h) => h.status === 'unauthorized');
  const hasOffline = allHooks.some((h) => h.status === 'offline');
  const firstError = allHooks.find((h) => h.status === 'error')?.error || null;
  const anyReady = allHooks.some((h) => h.status === 'ready');

  let overallStatus: TableDataStatus = 'ready';
  if (hasUnauthorized) overallStatus = 'unauthorized';
  else if (hasOffline) overallStatus = 'offline';
  else if (firstError && !anyReady) overallStatus = 'error';
  else if (isLoading && !anyReady) overallStatus = 'loading';
  else if (!anyReady && allHooks.every((h) => h.status === 'empty')) overallStatus = 'empty';

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
    status: {
      overall: overallStatus,
      isStale,
      isLoading,
      errorMessage: firstError,
    },
    refreshAll: async () => {
      await Promise.all([
        appointments.refresh(),
        payments.refresh(),
        treatments.refresh(),
        finance.refresh(),
      ]);
    },
  };
}
