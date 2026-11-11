import { supabase, type TreatmentService } from '@/lib/supabase';
import { todayGregorian } from '@/lib/jalali';

export type ServiceStatus = TreatmentService['status'];

export type ServiceDraft = {
  id: string | null;
  service_date: string;
  tooth_number: number | null;
  surfaces: string;
  procedure_name: string;
  quantity: number;
  unit_fee: number;
  status: ServiceStatus;
  notes: string;
};

export const SERVICE_STATUS_OPTIONS: { value: ServiceStatus; label: string }[] = [
  { value: 'planned', label: 'برنامه‌ریزی' },
  { value: 'done', label: 'انجام‌شده' },
  { value: 'cancelled', label: 'لغوشده' },
];

export const PROCEDURE_SUGGESTIONS = [
  'معاینه و مشاوره',
  'جرم‌گیری و بهداشت دهان',
  'ترمیم کامپوزیت',
  'ترمیم آمالگام',
  'ترمیم موقت',
  'درمان ریشه (اندو)',
  'ری‌اندو',
  'کشیدن دندان',
  'جراحی لثه',
  'ایمپلنت',
  'تاج پرسلن فلزی',
  'تاج زیرکونیا',
  'ونیر',
  'لمینیت',
  'بلیچینگ',
  'پروفیلاکسی',
  'ارتودنسی',
];

export const SURFACE_SUGGESTIONS = ['O', 'M', 'D', 'B', 'L', 'MO', 'DO', 'MOD', 'MOB', 'DOB', 'MODBL'];

export function emptyServiceDraft(): ServiceDraft {
  return {
    id: null,
    service_date: todayGregorian(),
    tooth_number: null,
    surfaces: '',
    procedure_name: '',
    quantity: 1,
    unit_fee: 0,
    status: 'planned',
    notes: '',
  };
}

export function toServiceDraft(s: TreatmentService): ServiceDraft {
  return {
    id: s.id,
    service_date: s.service_date,
    tooth_number: s.tooth_number,
    surfaces: s.surfaces ?? '',
    procedure_name: s.procedure_name,
    quantity: s.quantity,
    unit_fee: Number(s.unit_fee),
    status: s.status,
    notes: s.notes ?? '',
  };
}

export function serviceLineTotal(s: Pick<ServiceDraft, 'quantity' | 'unit_fee' | 'status'>): number {
  if (s.status === 'cancelled') return 0;
  return (Number(s.quantity) || 0) * (Number(s.unit_fee) || 0);
}

export function validateServiceDraft(s: ServiceDraft): string | null {
  if (!s.procedure_name.trim()) return 'نام خدمت را وارد کنید.';
  if (!s.service_date) return 'تاریخ خدمت را انتخاب کنید.';
  if (!Number.isInteger(Number(s.quantity)) || Number(s.quantity) < 1) return 'تعداد باید عدد صحیح و حداقل ۱ باشد.';
  if (Number(s.unit_fee) < 0 || Number.isNaN(Number(s.unit_fee))) return 'دستمزد نمی‌تواند منفی باشد.';
  return null;
}

export type TreatmentPayload = {
  patient_id: string;
  tooth_numbers?: string | null;
  diagnosis: string | null;
  treatment_plan: string | null;
  status: string;
  lab_cost: number;
  material_cost: number;
  other_cost: number;
  discount: number;
  notes: string | null;
};

export async function saveTreatmentRecord(params: {
  treatmentId: string | null;
  payload: TreatmentPayload;
  services: ServiceDraft[];
  originalServiceIds: string[];
}): Promise<boolean> {
  const { treatmentId: existingId, payload, services, originalServiceIds } = params;

  let treatmentId = existingId;
  if (treatmentId) {
    const { error } = await supabase.from('treatments').update(payload).eq('id', treatmentId);
    if (error) return false;
  } else {
    const { data, error } = await supabase.from('treatments').insert(payload).select('id').single();
    if (error || !data) return false;
    treatmentId = data.id as string;
  }

  const keptIds = services.map(s => s.id).filter((id): id is string => id !== null);
  const removedIds = originalServiceIds.filter(id => !keptIds.includes(id));
  if (removedIds.length > 0) {
    const { error } = await supabase.from('treatment_services').delete().in('id', removedIds);
    if (error) return false;
  }

  for (const s of services) {
    const row = {
      service_date: s.service_date,
      tooth_number: s.tooth_number,
      surfaces: s.surfaces.trim() || null,
      procedure_name: s.procedure_name.trim(),
      quantity: Number(s.quantity),
      unit_fee: Number(s.unit_fee),
      status: s.status,
      notes: s.notes.trim() || null,
    };
    if (s.id) {
      const { error } = await supabase.from('treatment_services').update(row).eq('id', s.id);
      if (error) return false;
    } else {
      const { error } = await supabase.from('treatment_services').insert({ ...row, treatment_id: treatmentId });
      if (error) return false;
    }
  }

  return true;
}
