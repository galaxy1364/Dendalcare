import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://civqyrhmrjcgmmtwkkmi.supabase.co';
export const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdnF5cmhtcmpjZ21tdHdra21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNzgyMjUsImV4cCI6MjEwNTk1NDIyNX0.RQO1-KIULLQikZ0f7mEYLWunn6j0GCxfiARWnM93054';


export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

export type Patient = {
  id: string;
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
  created_at: string;
  updated_at: string;
};

export type TreatmentService = {
  id: string;
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
  patient_id: string | null;
  treatment_id: string | null;
  amount: number;
  payment_method: string;
  payment_date: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type LabOrder = {
  id: string;
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
  created_at: string;
  updated_at: string;
};

export type Reminder = {
  id: string;
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
  patient_id: string | null;
  installment_id: string | null;
  check_number: string | null;
  bank_name: string | null;
  amount: number;
  issue_date: string;
  due_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Safteh = {
  id: string;
  patient_id: string | null;
  installment_id: string | null;
  safteh_number: string | null;
  amount: number;
  issue_date: string;
  due_date: string;
  guarantor_name: string | null;
  guarantor_national_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffSalary = {
  id: string;
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
  staff_id: string | null;
  share_type: 'percentage' | 'fixed';
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
  | 'staff_salaries'
  | 'staff_shares'
  | 'messages'
  | 'advertisements'
  | 'clinic_settings'
  | 'safteh';
