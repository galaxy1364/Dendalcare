import { useMemo, useState } from 'react';
import { Wallet, UserCog, FlaskConical, Package, Percent, ShieldAlert } from 'lucide-react';
import { Field, Input, Textarea, Select, Button } from '@/components/ui/Form';
import { ServicesEditor } from '@/components/sections/TreatmentServicesEditor';
import type { Patient, Treatment, TreatmentService } from '@/lib/supabase';
import {
  saveTreatmentRecord, toServiceDraft, serviceLineTotal,
  type ServiceDraft,
} from '@/lib/treatmentServices';
import { loadActiveUser } from '@/lib/cloudSyncEngine';

const fmt = (n: number) => Number(n).toLocaleString('fa-IR');

const TREATMENT_STATUS_OPTIONS = [
  { value: 'planned', label: 'برنامه‌ریزی' },
  { value: 'in_progress', label: 'در حال انجام' },
  { value: 'completed', label: 'تکمیل‌شده' },
  { value: 'cancelled', label: 'لغوشده' },
];

type Props = {
  treatment: Treatment | null;
  treatmentServices: TreatmentService[];
  patients: Patient[];
  onSaved: () => void;
};

export function TreatmentForm({ treatment, treatmentServices, patients, onSaved }: Props) {
  const activeUser = useMemo(() => loadActiveUser(), []);
  // Only Manager (Dr. Mehdi Amiri) can alter prices/discounts after initial record creation
  const isPriceLocked = Boolean(treatment?.id && activeUser.role !== 'manager' && !activeUser.permissions?.canEditPricesAfterSave);

  const [patientId, setPatientId] = useState(treatment?.patient_id ?? '');
  const [toothNumbers, setToothNumbers] = useState(treatment?.tooth_numbers ?? '');
  const [diagnosis, setDiagnosis] = useState(treatment?.diagnosis ?? '');
  const [plan, setPlan] = useState(treatment?.treatment_plan ?? '');
  const [status, setStatus] = useState(treatment?.status ?? 'planned');
  const [labCost, setLabCost] = useState(Number(treatment?.lab_cost ?? 0));
  const [materialCost, setMaterialCost] = useState(Number(treatment?.material_cost ?? 0));
  const [otherCost, setOtherCost] = useState(Number(treatment?.other_cost ?? 0));
  const [discount, setDiscount] = useState(Number(treatment?.discount ?? 0));
  const [notes, setNotes] = useState(treatment?.notes ?? '');
  const [services, setServices] = useState<ServiceDraft[]>(() => treatmentServices.map(toServiceDraft));
  const [originalServiceIds] = useState(() => treatmentServices.map(s => s.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doctorCost = useMemo(() => {
    if (services.length === 0) return Number(treatment?.doctor_cost ?? 0);
    return services.reduce((sum, s) => sum + serviceLineTotal(s), 0);
  }, [services, treatment]);

  const totalCost = doctorCost + (Number(labCost) || 0) + (Number(materialCost) || 0)
    + (Number(otherCost) || 0) - (Number(discount) || 0);

  const submit = async () => {
    if (!patientId) {
      setError('لطفاً بیمار را انتخاب کنید.');
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await saveTreatmentRecord({
      treatmentId: treatment?.id ?? null,
      payload: {
        patient_id: patientId,
        tooth_numbers: toothNumbers.trim() || null,
        diagnosis: diagnosis.trim() || null,
        treatment_plan: plan.trim() || null,
        status,
        lab_cost: isPriceLocked ? Number(treatment?.lab_cost ?? 0) : (Number(labCost) || 0),
        material_cost: isPriceLocked ? Number(treatment?.material_cost ?? 0) : (Number(materialCost) || 0),
        other_cost: isPriceLocked ? Number(treatment?.other_cost ?? 0) : (Number(otherCost) || 0),
        discount: isPriceLocked ? Number(treatment?.discount ?? 0) : (Number(discount) || 0),
        notes: notes.trim() || null,
      },
      services,
      originalServiceIds,
    });
    setSaving(false);
    if (!ok) {
      setError('ذخیره انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    onSaved();
  };

  return (
    <div className="space-y-3.5">
      {isPriceLocked && (
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-3 flex items-center gap-2 text-amber-800 text-xs font-bold">
          <ShieldAlert size={16} className="text-amber-600 shrink-0" />
          <span>قفل امنیتی قیمت فعال است: پس از ثبت اولیه، تغییر مبالغ و تخفیف فقط با دسترسی مدیر (دکتر مهدی امیری) امکان‌پذیر است.</span>
        </div>
      )}
      <Field label="بیمار">
        <Select
          value={patientId}
          onChange={e => setPatientId(e.target.value)}
          options={[
            { value: '', label: 'انتخاب بیمار...' },
            ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` })),
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="شماره دندان‌ها (FDI / پالمر)">
          <Input value={toothNumbers} onChange={e => setToothNumbers(e.target.value)} placeholder="مثلاً 16, 21 یا دندان 6 بالا" />
        </Field>
        <Field label="وضعیت درمان">
          <Select value={status} onChange={e => setStatus(e.target.value)} options={TREATMENT_STATUS_OPTIONS} />
        </Field>
      </div>
      <div>
        <Field label="تشخیص بیماری">
          <Input value={diagnosis} onChange={e => setDiagnosis(e.target.value)} placeholder="تشخیص بیماری..." />
        </Field>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {['پوسیدگی اکلوزال', 'پالپیت برگشت‌ناپذیر', 'نکروز پالپ / آبسه', 'شکستگی دندان', 'پریودنتیت', 'کشیدن ریشه'].map(d => (
            <button
              type="button"
              key={d}
              onClick={() => setDiagnosis(d)}
              className="px-2 py-0.5 rounded text-[10px] bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200"
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <Field label="طرح درمان">
        <Textarea value={plan} onChange={e => setPlan(e.target.value)} rows={2} placeholder="شرح طرح درمان..." />
      </Field>

      <div className="rounded-2xl bg-violet-50/40 p-3">
        <ServicesEditor services={services} onChange={isPriceLocked ? () => {} : setServices} />
      </div>

      <div className="rounded-2xl bg-violet-50/60 p-3 space-y-3">
        <p className="text-xs font-bold text-violet-700 flex items-center gap-1.5">
          <Wallet size={14} /> هزینه‌های درمان {isPriceLocked && <span className="text-[10px] text-amber-600">(قفل مدیریتی)</span>}
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="دستمزد پزشک (از خدمات)">
            <div className="relative">
              <UserCog size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-400" />
              <Input value={fmt(doctorCost)} readOnly className="pr-9 bg-gray-50 text-gray-500" />
            </div>
          </Field>
          <Field label="هزینه لابراتوار">
            <div className="relative">
              <FlaskConical size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-pink-400" />
              <Input type="number" min={0} readOnly={isPriceLocked} value={labCost} onChange={e => !isPriceLocked && setLabCost(Number(e.target.value))} className={`pr-9 ${isPriceLocked ? 'bg-gray-100 text-gray-500' : ''}`} placeholder="0" />
            </div>
          </Field>
          <Field label="مواد مصرفی">
            <div className="relative">
              <Package size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-orange-400" />
              <Input type="number" min={0} readOnly={isPriceLocked} value={materialCost} onChange={e => !isPriceLocked && setMaterialCost(Number(e.target.value))} className={`pr-9 ${isPriceLocked ? 'bg-gray-100 text-gray-500' : ''}`} placeholder="0" />
            </div>
          </Field>
          <Field label="سایر هزینه‌ها">
            <div className="relative">
              <Wallet size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input type="number" min={0} readOnly={isPriceLocked} value={otherCost} onChange={e => !isPriceLocked && setOtherCost(Number(e.target.value))} className={`pr-9 ${isPriceLocked ? 'bg-gray-100 text-gray-500' : ''}`} placeholder="0" />
            </div>
          </Field>
        </div>
        <Field label="تخفیف (تومان)">
          <div className="relative">
            <Percent size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400" />
            <Input type="number" min={0} readOnly={isPriceLocked} value={discount} onChange={e => !isPriceLocked && setDiscount(Number(e.target.value))} className={`pr-9 ${isPriceLocked ? 'bg-gray-100 text-gray-500' : ''}`} placeholder="0" />
          </div>
        </Field>
        <div className="flex items-center justify-between pt-2 border-t border-violet-100">
          <span className="text-xs font-bold text-gray-600">هزینه کل</span>
          <span className="text-lg font-black text-violet-600">{fmt(totalCost)} ت</span>
        </div>
      </div>

      <Field label="یادداشت">
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="یادداشت..." />
      </Field>

      {error && <p className="text-xs text-red-500 px-1">{error}</p>}

      <Button onClick={submit} color="#8B5CF6" disabled={saving} className="w-full">
        {saving ? 'در حال ذخیره...' : 'ذخیره درمان'}
      </Button>
    </div>
  );
}
