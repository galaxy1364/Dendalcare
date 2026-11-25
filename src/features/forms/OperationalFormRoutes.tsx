import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarPlus, CheckCircle2, FilePlus2, Stethoscope } from 'lucide-react';
import { supabase, type Patient } from '@/lib/supabase';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { todayGregorian } from '@/lib/jalali';
import { ACTIVE_TENANT_ID, getActiveBranchId } from '@/services/authentication/authService';
import { HapticEngine } from '@/platform/haptics';
import { clearRouteDraft, getRouteDraft, saveRouteDraft, useNavigation } from '@/navigation/NavigationStack';
import { useClinicShell } from '@/app/AppProviders';
import { Button, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { useUpdateSafePointGuard } from '@/services/updates';

/**
 * Shared inline confirmation bar preventing accidental loss of unsaved clinical drafts.
 */
function UnsavedDraftConfirmBar({
  onKeepDraftAndLeave,
  onDiscardAndLeave,
  onContinueEditing,
}: {
  onKeepDraftAndLeave: () => void;
  onDiscardAndLeave: () => void;
  onContinueEditing: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="تایید خروج از فرم با تغییرات ذخیره‌نشده"
      data-testid="form_leave_confirm"
      className="rounded-[16px] p-3 bg-[#FFFBEB] dark:bg-[#291E0B] border border-[#FDE0A6] dark:border-[#78350F] space-y-2"
    >
      <div className="flex items-center gap-2 text-xs font-black text-[#92510C] dark:text-[#FCD34D]">
        <AlertTriangle size={15} className="shrink-0" />
        <span>اطلاعات واردشده هنوز در سرور ثبت نشده‌اند. مایل به خروج هستید؟</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          data-testid="form_leave_keep_draft"
          onClick={onKeepDraftAndLeave}
          className="min-h-[44px] px-3 rounded-[10px] bg-white dark:bg-[#11202E] border border-[#FDE0A6] text-[#92510C] dark:text-[#FCD34D] text-xs font-bold"
        >
          ذخیره پیش‌نویس و بازگشت
        </button>
        <button
          type="button"
          data-testid="form_leave_discard"
          onClick={onDiscardAndLeave}
          className="min-h-[44px] px-3 rounded-[10px] bg-[#FFF1F2] dark:bg-[#3A1622] border border-[#FECDD3] text-[#AD293C] dark:text-[#FDA4AF] text-xs font-bold"
        >
          پاک کردن و خروج
        </button>
        <button
          type="button"
          data-testid="form_leave_continue"
          onClick={onContinueEditing}
          className="min-h-[44px] px-3 rounded-[10px] bg-[#087C76] text-white text-xs font-bold"
        >
          ادامه ویرایش
        </button>
      </div>
    </div>
  );
}

/**
 * V4 Dedicated Full-Screen Operational Form Routes:
 * - PatientFormPage ('patient_form')
 * - AppointmentFormPage ('appointment_form')
 * - TreatmentFormPage ('treatment_form')
 * All mutations stamp active tenant/branch context, stamp `performed_at`/`completed_at` on completed treatments,
 * confirm before leaving dirty forms, and fire HapticEngine.success() ONLY on server confirmation.
 */

export function PatientFormPage() {
  const { goBack, navigate } = useNavigation();
  const { showSyncToast, currentUser } = useClinicShell();
  const draft = getRouteDraft<Record<string, string>>('patient_form');
  const [firstName, setFirstName] = useState(draft?.firstName ?? '');
  const [lastName, setLastName] = useState(draft?.lastName ?? '');
  const [phone, setPhone] = useState(draft?.phone ?? '');
  const [nationalId, setNationalId] = useState(draft?.nationalId ?? '');
  const [fileNo, setFileNo] = useState(draft?.fileNo ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const isDirty = Boolean(
    firstName.trim() || lastName.trim() || phone.trim() || nationalId.trim() || fileNo.trim() || notes.trim()
  );
  useUpdateSafePointGuard(
    'patient_form_dirty',
    isDirty || saving,
    'فرم ثبت پرونده بیمار جدید دارای تغییرات ذخیره‌نشده است'
  );

  useEffect(() => {
    saveRouteDraft('patient_form', { firstName, lastName, phone, nationalId, fileNo, notes });
  }, [firstName, lastName, phone, nationalId, fileNo, notes]);

  const handleRequestCancel = () => {
    if (isDirty) {
      HapticEngine.warning();
      setShowLeaveConfirm(true);
      return;
    }
    goBack();
  };

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
    clearRouteDraft('patient_form');
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
            <p className="text-xs font-medium text-[#526779] dark:text-[#9FB1C1]">صفحه عملیاتی مستقل با همگام‌سازی فوری شعبه</p>
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

        {showLeaveConfirm && (
          <UnsavedDraftConfirmBar
            onKeepDraftAndLeave={() => goBack()}
            onDiscardAndLeave={() => {
              clearRouteDraft('patient_form');
              goBack();
            }}
            onContinueEditing={() => setShowLeaveConfirm(false)}
          />
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button color="#176B52" disabled={saving} onClick={handleSave} className="flex-1 min-h-[48px]">
            <CheckCircle2 size={15} />
            {saving ? 'در حال ثبت...' : 'ثبت پرونده بیمار'}
          </Button>
          <button
            type="button"
            onClick={handleRequestCancel}
            className="min-h-[48px] px-4 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold"
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

  const draft = getRouteDraft<Record<string, string>>('appointment_form');
  const [patientId, setPatientId] = useState(draft?.patientId ?? '');
  const [title, setTitle] = useState(draft?.title ?? 'ویزیت و معاینه تخصصی');
  const [date, setDate] = useState(draft?.date ?? todayGregorian());
  const [time, setTime] = useState(draft?.time ?? '17:00');
  const [duration, setDuration] = useState(draft?.duration ?? '30');
  const [type, setType] = useState(draft?.type ?? 'checkup');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const isDirty = Boolean(patientId || notes.trim() || title.trim() !== 'ویزیت و معاینه تخصصی');
  useUpdateSafePointGuard(
    'appointment_form_dirty',
    isDirty || saving,
    'فرم ثبت نوبت جدید دارای تغییرات ذخیره‌نشده است'
  );

  useEffect(() => {
    saveRouteDraft('appointment_form', { patientId, title, date, time, duration, type, notes });
  }, [patientId, title, date, time, duration, type, notes]);

  const handleRequestCancel = () => {
    if (isDirty) {
      HapticEngine.warning();
      setShowLeaveConfirm(true);
      return;
    }
    goBack();
  };

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
    clearRouteDraft('appointment_form');
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
            <p className="text-xs font-medium text-[#526779] dark:text-[#9FB1C1]">زمان‌بندی مستقل با تقویم شمسی و ثبت آنی</p>
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

        {showLeaveConfirm && (
          <UnsavedDraftConfirmBar
            onKeepDraftAndLeave={() => goBack()}
            onDiscardAndLeave={() => {
              clearRouteDraft('appointment_form');
              goBack();
            }}
            onContinueEditing={() => setShowLeaveConfirm(false)}
          />
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button color="#92510C" disabled={saving} onClick={handleSave} className="flex-1 min-h-[48px]">
            <CheckCircle2 size={15} />
            {saving ? 'در حال ثبت...' : 'ثبت نوبت بیمار'}
          </Button>
          <button
            type="button"
            onClick={handleRequestCancel}
            className="min-h-[48px] px-4 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold"
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

  const draft = getRouteDraft<Record<string, string>>('treatment_form');
  const [patientId, setPatientId] = useState(draft?.patientId ?? '');
  const [diagnosis, setDiagnosis] = useState(draft?.diagnosis ?? '');
  const [treatmentPlan, setTreatmentPlan] = useState(draft?.treatmentPlan ?? '');
  const [toothNumbers, setToothNumbers] = useState(draft?.toothNumbers ?? '');
  const [totalCost, setTotalCost] = useState(draft?.totalCost ?? '');
  const [discount, setDiscount] = useState(draft?.discount ?? '0');
  const [status, setStatus] = useState(draft?.status ?? 'planned');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const isDirty = Boolean(
    patientId || diagnosis.trim() || treatmentPlan.trim() || toothNumbers.trim() || totalCost.trim()
  );
  useUpdateSafePointGuard(
    'treatment_form_dirty',
    isDirty || saving,
    'فرم ثبت طرح درمان جدید دارای تغییرات ذخیره‌نشده است'
  );

  useEffect(() => {
    saveRouteDraft('treatment_form', {
      patientId,
      diagnosis,
      treatmentPlan,
      toothNumbers,
      totalCost,
      discount,
      status,
    });
  }, [patientId, diagnosis, treatmentPlan, toothNumbers, totalCost, discount, status]);

  const handleRequestCancel = () => {
    if (isDirty) {
      HapticEngine.warning();
      setShowLeaveConfirm(true);
      return;
    }
    goBack();
  };

  const handleSave = async () => {
    if (!treatmentPlan.trim()) {
      setErrorMsg('شرح طرح درمان الزامی است.');
      HapticEngine.warning();
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const nowIso = new Date().toISOString();
    const isCompleted = status === 'completed';
    const res = await supabase.from('treatments').insert({
      tenant_id: currentUser.tenantId || ACTIVE_TENANT_ID,
      branch_id: getActiveBranchId(),
      patient_id: patientId || null,
      diagnosis: diagnosis.trim() || null,
      treatment_plan: treatmentPlan.trim(),
      tooth_numbers: toothNumbers.trim() || null,
      total_cost: Math.max(0, Math.round(Number(totalCost) || 0)),
      discount: Math.max(0, Math.round(Number(discount) || 0)),
      paid_amount: 0,
      doctor_cost: 0,
      lab_cost: 0,
      material_cost: 0,
      other_cost: 0,
      status,
      performed_at: isCompleted ? nowIso : null,
      completed_at: isCompleted ? nowIso : null,
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
    clearRouteDraft('treatment_form');
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
            <p className="text-xs font-medium text-[#526779] dark:text-[#9FB1C1]">فرم مستقل بالینی با محاسبه تخفیف و همگام‌سازی فوری</p>
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

        {showLeaveConfirm && (
          <UnsavedDraftConfirmBar
            onKeepDraftAndLeave={() => goBack()}
            onDiscardAndLeave={() => {
              clearRouteDraft('treatment_form');
              goBack();
            }}
            onContinueEditing={() => setShowLeaveConfirm(false)}
          />
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button color="#5B3CC4" disabled={saving} onClick={handleSave} className="flex-1 min-h-[48px]">
            <CheckCircle2 size={15} />
            {saving ? 'در حال ثبت...' : 'ثبت طرح درمان'}
          </Button>
          <button
            type="button"
            onClick={handleRequestCancel}
            className="min-h-[48px] px-4 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
