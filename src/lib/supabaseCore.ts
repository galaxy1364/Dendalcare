import { createClient } from '@supabase/supabase-js';

// V11 development database cutover. Only the low-privilege publishable key is client-side.
export const SUPABASE_PROJECT_REF = 'npzcweiphmyhtzxxnlov';
export const EXPECTED_SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_H8XKNNvn_52H4s1bgMtcjQ_YAvOLtAB';

export function validateSupabasePublicConfig(env: {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}): { url: string; publishableKey: string; projectRef: string } {
  const configuredUrl = env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const configuredKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const legacyKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (configuredUrl && configuredUrl !== EXPECTED_SUPABASE_URL) {
    throw new Error('SUPABASE_PROJECT_MISMATCH: update the environment to the V11 development project.');
  }
  if (legacyKey && legacyKey !== (configuredKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('SUPABASE_LEGACY_KEY_MISMATCH: remove the old VITE_SUPABASE_ANON_KEY.');
  }
  if (configuredKey && !configuredKey.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_INVALID_PUBLIC_KEY: a publishable key is required.');
  }

  return {
    url: EXPECTED_SUPABASE_URL,
    publishableKey: configuredKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    projectRef: SUPABASE_PROJECT_REF,
  };
}

export function getBackendNamespaceKey(baseKey: string, projectRef: string = SUPABASE_PROJECT_REF): string {
  const cleanRef = (projectRef || SUPABASE_PROJECT_REF).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${baseKey}__proj_${cleanRef}`;
}

const resolvedSupabaseConfig = validateSupabasePublicConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
});

export const supabaseUrl = resolvedSupabaseConfig.url;
// Compatibility export for existing consumers; never contains a secret/service-role key.
export const supabaseAnonKey = resolvedSupabaseConfig.publishableKey;
export const SUPABASE_AUTH_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

export const rawSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

export type Patient = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  first_name: string;
  last_name: string;
  national_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birth_date: string | null;
  gender: 'male' | 'female' | 'unknown';
  blood_type: string | null;
  allergies: string | null;
  medical_history: string | null;
  medications: string | null;
  insurance_provider: string | null;
  insurance_number: string | null;
  notes: string | null;
  photo_url: string | null;
  status: 'active' | 'inactive' | 'archived';
  created_at: string;
  updated_at: string;
};

export type Appointment = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  staff_id: string | null;
  title: string | null;
  appointment_date: string;
  appointment_time: string;
  duration_min: number;
  type: string;
  status: string;
  notes: string | null;
  room: string | null;
  created_at: string;
  updated_at: string;
};

export type Treatment = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  appointment_id: string | null;
  diagnosis: string | null;
  treatment_plan: string | null;
  tooth_numbers: string | null;
  status: string;
  total_cost: number;
  paid_amount: number;
  doctor_cost: number;
  lab_cost: number;
  material_cost: number;
  other_cost: number;
  discount: number;
  notes: string | null;
  performed_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type TreatmentService = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  treatment_id: string;
  service_date: string;
  tooth_number: number | null;
  surfaces: string | null;
  procedure_name: string;
  quantity: number;
  unit_fee: number;
  status: 'planned' | 'done' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  treatment_id: string | null;
  amount: number;
  payment_method: string;
  payment_date: string;
  description: string | null;
  status: string;
  refunded_at?: string | null;
  voided_at?: string | null;
  reversed_payment_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type LabOrder = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  lab_name: string | null;
  work_type: string;
  tooth_numbers: string | null;
  shade: string | null;
  material: string | null;
  status: string;
  sent_date: string;
  due_date: string | null;
  received_date: string | null;
  cost: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Implant = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  tooth_number: number | null;
  brand: string | null;
  implant_size: string | null;
  stage: string;
  placement_date: string | null;
  osseointegration_date: string | null;
  abutment_date: string | null;
  crown_date: string | null;
  cost: number;
  paid_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryItem = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  name: string;
  category: string;
  sku: string | null;
  quantity: number;
  unit: string;
  min_quantity: number;
  reorder_quantity: number;
  unit_cost: number;
  supplier: string | null;
  location: string | null;
  expiry_date: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type Reminder = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  title: string;
  description: string | null;
  reminder_date: string;
  reminder_time: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type FinanceTransaction = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  payment_id?: string | null;
  treatment_id?: string | null;
  type: 'income' | 'expense' | 'transfer';
  category: string;
  amount: number;
  transaction_date: string;
  description: string | null;
  patient_id: string | null;
  payment_method: string;
  reference: string | null;
  created_at: string;
  updated_at: string;
};

export type Staff = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  first_name: string;
  last_name: string;
  role: string;
  phone: string | null;
  email: string | null;
  color: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ToothCondition = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  tooth_number: number;
  condition: string;
  surface: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Installment = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  treatment_id: string | null;
  total_amount: number;
  paid_amount: number;
  monthly_amount: number;
  total_months: number;
  paid_months: number;
  start_date: string;
  next_due_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Check = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  installment_id?: string | null;
  treatment_id?: string | null;
  check_number: string | null;
  bank_name: string | null;
  branch?: string | null;
  sayad_id?: string | null;
  amount: number;
  issue_date?: string;
  due_date: string;
  status: string;
  type?: string;
  drawer_name?: string | null;
  is_guarantee?: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Safteh = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string | null;
  installment_id?: string | null;
  safteh_number: string | null;
  amount: number;
  issue_date?: string;
  due_date: string;
  type?: string;
  drawer_name?: string | null;
  guarantor_name: string | null;
  guarantor_national_id?: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffSalary = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  staff_id: string | null;
  base_salary: number;
  bonus: number;
  deductions: number;
  total_paid: number;
  share_amount: number;
  pay_month: number;
  pay_year: number;
  status: string;
  pay_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffShare = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  staff_id: string | null;
  share_type: 'percentage' | 'fixed' | 'net_half_after_lab';
  share_value: number;
  applies_to: string;
  min_amount: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  from_staff_id: string | null;
  to_staff_id: string | null;
  subject: string;
  body: string | null;
  priority: string;
  is_read: boolean;
  created_at: string;
};

export type Advertisement = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  title: string;
  content: string | null;
  image_url: string | null;
  link_url: string | null;
  target_audience: string;
  status: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type ClinicSetting = {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  key: string;
  value: string | null;
  category: string;
  created_at: string;
  updated_at: string;
};

export type TableName =
  | 'patients'
  | 'appointments'
  | 'treatments'
  | 'treatment_services'
  | 'payments'
  | 'lab_orders'
  | 'implants'
  | 'inventory'
  | 'reminders'
  | 'finance_transactions'
  | 'staff'
  | 'tooth_conditions'
  | 'installments'
  | 'checks'
  | 'safteh'
  | 'staff_salaries'
  | 'staff_shares'
  | 'messages'
  | 'advertisements'
  | 'clinic_settings';
