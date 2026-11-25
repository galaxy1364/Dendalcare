import { useState } from 'react';
import { CalendarPlus, CheckCircle2, FilePlus2, Stethoscope } from 'lucide-react';
import { supabase, type Patient } from '@/lib/supabase';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { todayGregorian } from '@/lib/jalali';
import { ACTIVE_TENANT_ID, getActiveBranchId } from '@/services/authentication/authService';
import { HapticEngine } from '@/platform/haptics';
import { useNavigation } from '@/navigation/NavigationStack';
import { useClinicShell } from '@/app/AppProviders';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';

/**
 * FIX 05 — Dedicated Full-Screen Operational Form Routes:
 * - PatientFormPage ('patient_form')
 * - AppointmentFormPage ('appointment_form')
 * - TreatmentFormPage ('treatment_form')
 * All mutations stamp active tenant/branch context and fire HapticEngine.success() ONLY on server confirmation.
 */

export function PatientFormPage() {
  const { goBack, navigate } = useNavigation();
  const { showSyncToast, currentUser } = useClinicShell();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [fileNo, setFileNo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setErrorMsg('نام و نام خانوادگی بیمار الزامی است.');
      HapticEngine.warning();
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const res = await supabase.from('patients').insert({
      tenant_id: currentUser.tenantId || ACTIVE_TENANT_ID,
      branch_id: getActiveBranchId(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
      national_id: nationalId.trim() || null,
      insurance_number: fileNo.trim() || null,
      notes: notes.trim() || null,
      status: 'active',
    });
    setSaving(false);
    const outcome = getMutationOutcome(res);
    if (outcome === 'error') {
      HapticEngine.error();
      setErrorMsg(res.error?.message || 'خطا در ثبت پرونده بیمار');
      return;
    }
    if (outcome === 'confirmed') {
      HapticEngine.success();
      showSyncToast(`پرونده ${firstName.trim()} ${lastName.trim()} با موفقیت ثبت شد`, 3200);
    } else {
      HapticEngine.warning();
      showSyncToast('پرونده در صف آفلاین ذخیره شد و پس از اتصال تایید می‌شود', 3200);
    }
    navigate('patients');
  };

  return (
    <div className="space-y-3 pb-6 animate-fade-in-up" data-testid="patient_form_fullscreen_page">
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#B7E4CE] dark:border-[#25394D] shadow-sm space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-[14px] bg-[#ECFDF5] text-[#176B52] flex items-center justify-center">
            <FilePlus2 size={20} />
          </div>
          <div>
            <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9]">ثبت پرونده بیمار جدید</h2>
            <p className="text-[11px] font-medium text-[#526779] dark:text-[#9FB1C1]">صفحه عملیاتی مستقل با همگام‌سازی فوری شعبه</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Field label="نام *">
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="مثلاً سارا" />
          </Field>
          <Field label="نام خانوادگی *">
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="مثلاً رضایی" />
          </Field>
          <Field label="شماره موبایل">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912..." dir="ltr" className="text-left font-mono" />
          </Field>
          <Field label="کد ملی">
            <Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} placeholder="۱۰ رقمی" dir="ltr" className="text-left font-mono" />
          </Field>
          <Field label="شماره پرونده دستی">
            <Input value={fileNo} onChange={(e) => setFileNo(e.target.value)} placeholder="مثلاً 1045" dir="ltr" className="text-left font-mono" />
          </Field>
        </div>

        <Field label="سابقه پزشکی و توضیحات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="حساسیت دارویی، بیماری زمینه‌ای یا توضیحات پذیرش..." />
        </Field>

        {errorMsg && (
          <p className="text-xs font-bold text-[#AD293C] bg-[#FFF1F2] border border-[#FECDD3] rounded-[12px] px-3 py-2">
            {errorMsg}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button color="#176B52" disabled={saving} onClick={handleSave} className="flex-1">
            <CheckCircle2 size={15} />
            {saving ? 'در حال ثبت...' : 'ثبت پرونده بیمار'}
          </Button>
          <button
            type="button"
            onClick={goBack}
            className="min-h-[44px] px-4 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppointmentFormPage() {
  const { goBack, navigate } = useNavigation();
  const { showSyncToast, currentUser } = useClinicShell();
  const { data: patients } = useRealtimeTable<Patient>('patients', 'id,first_name,last_name,phone');

  const [patientId, setPatientId] = useState('');
  const [title, setTitle] = useState('ویزیت و معاینه تخصصی');
  const [date, setDate] = useState(todayGregorian());
  const [time, setTime] = useState('17:00');
  const [duration, setDuration] = useState('30');
  const [type, setType] = useState('checkup');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async () => {
    if (!title.trim() || !date) {
      setErrorMsg('عنوان نوبت و تاریخ الزامی است.');
      HapticEngine.warning();
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const res = await supabase.from('appointments').insert({
      tenant_id: currentUser.tenantId || ACTIVE_TENANT_ID,
      branch_id: getActiveBranchId(),
      patient_id: patientId || null,
      title: title.trim(),
      appointment_date: date,
      appointment_time: time,
      duration_min: Math.max(10, Number(duration) || 30),
      type,
      status: 'confirmed',
      notes: notes.trim() || null,
    });
    setSaving(false);
    const outcome = getMutationOutcome(res);
    if (outcome === 'error') {
      HapticEngine.error();
      setErrorMsg(res.error?.message || 'خطا در ثبت نوبت');
      return;
    }
    if (outcome === 'confirmed') {
      HapticEngine.success();
      showSyncToast('نوبت بیمار با موفقیت در سرور ثبت شد', 3200);
    } else {
      HapticEngine.warning();
      showSyncToast('نوبت در صف آفلاین ذخیره شد و پس از اتصال تایید می‌شود', 3200);
    }
    navigate('appointments', { date });
  };

  return (
    <div className="space-y-3 pb-6 animate-fade-in-up" data-testid="appointment_form_fullscreen_page">
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#FDE0A6] dark:border-[#25394D] shadow-sm space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-[14px] bg-[#FFFBEB] text-[#92510C] flex items-center justify-center">
            <CalendarPlus size={20} />
          </div>
          <div>
            <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9]">ثبت نوبت جدید</h2>
            <p className="text-[11px] font-medium text-[#526779] dark:text-[#9FB1C1]">زمان‌بندی مستقل با تقویم شمسی و ثبت آنی</p>
          </div>
        </div>

        <Field label="انتخاب بیمار">
          <Select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            options={[
              { value: '', label: 'انتخاب بیمار از پرونده‌ها...' },
              ...patients.map((p) => ({
                value: p.id,
                label: `${p.first_name} ${p.last_name}${p.phone ? ` (${p.phone})` : ''}`,
              })),
            ]}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Field label="عنوان نوبت *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="نوع خدمت">
            <Select
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={[
                { value: 'checkup', label: 'ویزیت و معاینه' },
                { value: 'treatment', label: 'درمان و ترمیم' },
                { value: 'implant', label: 'جراحی / ایمپلنت' },
                { value: 'prosthesis', label: 'قالب‌گیری / پروتز' },
                { value: 'emergency', label: 'اورژانسی' },
              ]}
            />
          </Field>
          <Field label="تاریخ شمسی">
            <JalaliDatePicker value={date} onChange={setDate} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="ساعت">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="font-mono" />
            </Field>
            <Field label="مدت (دقیقه)">
              <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} className="font-mono" />
            </Field>
          </div>
        </div>

        <Field label="یادداشت پذیرش">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="توضیحات تکمیلی نوبت..." />
        </Field>

        {errorMsg && (
          <p className="text-xs font-bold text-[#AD293C] bg-[#FFF1F2] border border-[#FECDD3] rounded-[12px] px-3 py-2">
            {errorMsg}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button color="#92510C" disabled={saving} onClick={handleSave} className="flex-1">
            <CheckCircle2 size={15} />
            {saving ? 'در حال ثبت...' : 'ثبت نوبت بیمار'}
          </Button>
          <button
            type="button"
            onClick={goBack}
            className="min-h-[44px] px-4 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

export function TreatmentFormPage() {
  const { goBack, navigate } = useNavigation();
  const { showSyncToast, currentUser } = useClinicShell();
  const { data: patients } = useRealtimeTable<Patient>('patients', 'id,first_name,last_name,phone');

  const [patientId, setPatientId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [toothNumbers, setToothNumbers] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [discount, setDiscount] = useState('0');
  const [status, setStatus] = useState('planned');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async () => {
    if (!treatmentPlan.trim()) {
      setErrorMsg('شرح طرح درمان الزامی است.');
      HapticEngine.warning();
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const res = await supabase.from('treatments').insert({
      tenant_id: currentUser.tenantId || ACTIVE_TENANT_ID,
      branch_id: getActiveBranchId(),
      patient_id: patientId || null,
      diagnosis: diagnosis.trim() || null,
      treatment_plan: treatmentPlan.trim(),
      tooth_numbers: toothNumbers.trim() || null,
      total_cost: Math.max(0, Number(totalCost) || 0),
      discount: Math.max(0, Number(discount) || 0),
      paid_amount: 0,
      doctor_cost: 0,
      lab_cost: 0,
      material_cost: 0,
      other_cost: 0,
      status,
    });
    setSaving(false);
    const outcome = getMutationOutcome(res);
    if (outcome === 'error') {
      HapticEngine.error();
      setErrorMsg(res.error?.message || 'خطا در ثبت طرح درمان');
      return;
    }
    if (outcome === 'confirmed') {
      HapticEngine.success();
      showSyncToast('طرح درمان با موفقیت در سرور ثبت شد', 3200);
    } else {
      HapticEngine.warning();
      showSyncToast('طرح درمان در صف آفلاین ذخیره شد و پس از اتصال تایید می‌شود', 3200);
    }
    navigate('treatments');
  };

  return (
    <div className="space-y-3 pb-6 animate-fade-in-up" data-testid="treatment_form_fullscreen_page">
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#DDD6FE] dark:border-[#25394D] shadow-sm space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-[14px] bg-[#F5F3FF] text-[#5B3CC4] flex items-center justify-center">
            <Stethoscope size={20} />
          </div>
          <div>
            <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9]">ثبت طرح درمان جدید</h2>
            <p className="text-[11px] font-medium text-[#526779] dark:text-[#9FB1C1]">فرم مستقل بالینی با محاسبه تخفیف و همگام‌سازی فوری</p>
          </div>
        </div>

        <Field label="بیمار">
          <Select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            options={[
              { value: '', label: 'انتخاب بیمار...' },
              ...patients.map((p) => ({
                value: p.id,
                label: `${p.first_name} ${p.last_name}`,
              })),
            ]}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Field label="تشخیص بالینی">
            <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="مثلاً پوسیدگی عمیق" />
          </Field>
          <Field label="شماره دندان (پالمر)">
            <Input value={toothNumbers} onChange={(e) => setToothNumbers(e.target.value)} placeholder="مثلاً UR6" dir="ltr" className="text-left font-mono" />
          </Field>
          <Field label="مبلغ کل درمان (تومان)">
            <Input type="number" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} className="font-mono" />
          </Field>
          <Field label="تخفیف (تومان)">
            <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className="font-mono" />
          </Field>
        </div>

        <Field label="شرح طرح درمان *">
          <Textarea value={treatmentPlan} onChange={(e) => setTreatmentPlan(e.target.value)} placeholder="عصب‌کشی، ترمیم کامپوزیت یا روکش زیرکونیا..." />
        </Field>

        <Field label="وضعیت طرح درمان">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'planned', label: 'پیشنهادی (در انتظار تایید بیمار)' },
              { value: 'in_progress', label: 'در حال انجام' },
              { value: 'completed', label: 'تکمیل‌شده' },
            ]}
          />
        </Field>

        {errorMsg && (
          <p className="text-xs font-bold text-[#AD293C] bg-[#FFF1F2] border border-[#FECDD3] rounded-[12px] px-3 py-2">
            {errorMsg}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button color="#5B3CC4" disabled={saving} onClick={handleSave} className="flex-1">
            <CheckCircle2 size={15} />
            {saving ? 'در حال ثبت...' : 'ثبت طرح درمان'}
          </Button>
          <button
            type="button"
            onClick={goBack}
            className="min-h-[44px] px-4 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
