import React, { useState, useEffect } from 'react';
import {
  Phone, Calendar, Heart, AlertCircle, Pill, FileText, Shield,
  Stethoscope, Plus, Trash2,
} from 'lucide-react';
import { supabase, type Patient, type Treatment } from '@/lib/supabase';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr } from '@/lib/jalali';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { getRuntimeServerVerifiedRole } from '@/services/authentication/authService';
import {
  assessPatientAllergySafety,
  getPatientAllergyReviews,
  hydratePatientClinicalRecordFromServer,
  persistStructuredAllergyReviewCommand,
  type AllergyVerificationStatus,
  type StructuredAllergyReview,
} from '@/features/clinical-record/clinicalRecordService';
import { ClinicalNotesPanel } from './ClinicalNotesPanel';

export const GENDER_OPTIONS = [
  { value: 'male', label: 'مرد' },
  { value: 'female', label: 'زن' },
  { value: 'unknown', label: 'نامشخص' },
];
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const TREATMENT_STATUS = [
  { value: 'planned', label: 'برنامه‌ریزی' },
  { value: 'in_progress', label: 'در حال انجام' },
  { value: 'completed', label: 'تکمیل‌شده' },
  { value: 'cancelled', label: 'لغوشده' },
];

export function SectionHeader({
  title, count, onAdd, color, icon,
}: {
  title: string; count: number; onAdd: () => void; color: string; icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, color }}>
          {icon}
        </div>
        <h3 className="text-sm font-bold text-gray-700">{title}</h3>
        {count > 0 && <Badge color={color} bg={`${color}15`}>{count}</Badge>}
      </div>
      <button onClick={onAdd} className="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow haptic transition-transform" style={{ background: color }}>
        <Plus size={18} />
      </button>
    </div>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 text-center py-6">{text}</p>;
}

export function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1">{icon}<span className="text-[10px]">{label}</span></div>
      <p className="text-sm font-semibold text-gray-700">{value}</p>
    </div>
  );
}

export function DetailBlock({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color }}>{icon}<span className="text-xs font-bold">{label}</span></div>
      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 haptic">
      <Trash2 size={13} />
    </button>
  );
}

export function PatientForm({
  patient, nextFileNo, onSave, saving,
}: {
  patient: Patient | null; nextFileNo: string; onSave: (d: Partial<Patient>) => Promise<boolean>; saving: boolean;
}) {
  const existingFileNo = patient?.notes?.match(/\[پرونده:\s*([^\]]+)\]/)?.[1] || patient?.insurance_number || nextFileNo;
  const cleanNotes = (patient?.notes || '').replace(/\[پرونده:\s*[^\]]+\]\s*/g, '');

  const [formError, setFormError] = useState<string | null>(null);
  const [fileNo, setFileNo] = useState(existingFileNo);
  const [form, setForm] = useState({
    first_name: patient?.first_name ?? '', last_name: patient?.last_name ?? '',
    national_id: patient?.national_id ?? '', phone: patient?.phone ?? '',
    email: patient?.email ?? '', address: patient?.address ?? '',
    birth_date: patient?.birth_date ?? '', gender: patient?.gender ?? 'unknown',
    blood_type: patient?.blood_type ?? '', allergies: patient?.allergies ?? '',
    medical_history: patient?.medical_history ?? '', medications: patient?.medications ?? '',
    insurance_provider: patient?.insurance_provider ?? '', insurance_number: patient?.insurance_number ?? '',
    notes: cleanNotes, status: patient?.status ?? 'active',
  });
  const optional = (v: string) => v.trim() || null;

  const submit = async () => {
    if (!form.first_name.trim()) {
      setFormError('نام بیمار را وارد کنید.');
      return;
    }
    setFormError(null);
    const taggedNotes = `[پرونده: ${fileNo.trim() || nextFileNo}] ${form.notes.trim()}`.trim();
    const ok = await onSave({
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      national_id: optional(form.national_id),
      phone: optional(form.phone),
      email: optional(form.email),
      address: optional(form.address),
      allergies: optional(form.allergies),
      medical_history: optional(form.medical_history),
      medications: optional(form.medications),
      insurance_provider: optional(form.insurance_provider),
      insurance_number: optional(form.insurance_number) || fileNo.trim() || nextFileNo,
      notes: taggedNotes,
      birth_date: form.birth_date || null,
      blood_type: form.blood_type || null,
    });
    if (!ok) setFormError('ذخیره انجام نشد. لطفاً دوباره تلاش کنید.');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        <Field label="شماره پرونده (دستی/اتوماتیک)">
          <Input value={fileNo} onChange={(e) => setFileNo(e.target.value)} placeholder="مثلاً 1001" className="font-mono font-bold text-emerald-700 bg-emerald-50/50" />
        </Field>
        <Field label="نام"><Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder="نام" /></Field>
        <Field label="نام خانوادگی"><Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder="نام خانوادگی" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="کد ملی"><Input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} placeholder="کد ملی" /></Field>
        <Field label="تلفن همراه"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0912..." /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ تولد"><JalaliDatePicker value={form.birth_date} onChange={(v) => setForm({ ...form, birth_date: v })} /></Field>
        <Field label="جنسیت"><Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' | 'unknown' })} options={GENDER_OPTIONS} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="گروه خونی"><Select value={form.blood_type} onChange={(e) => setForm({ ...form, blood_type: e.target.value })} options={[{ value: '', label: 'نامشخص' }, ...BLOOD_TYPES.map((b) => ({ value: b, label: b }))]} /></Field>
        <Field label="ایمیل"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ایمیل" /></Field>
      </div>
      <Field label="آدرس"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} placeholder="آدرس" /></Field>
      <Field label="حساسیت‌ها (یادداشت کمکی؛ تأیید ۴ حالته در پرونده)"><Textarea value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} rows={2} placeholder="حساسیت‌های غذایی، دارویی..." /></Field>
      <Field label="سابقه پزشکی"><Textarea value={form.medical_history} onChange={(e) => setForm({ ...form, medical_history: e.target.value })} rows={2} placeholder="بیماری‌های زمینه‌ای..." /></Field>
      <Field label="داروهای مصرفی"><Textarea value={form.medications} onChange={(e) => setForm({ ...form, medications: e.target.value })} rows={2} placeholder="داروهای فعلی..." /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="بیمه"><Input value={form.insurance_provider} onChange={(e) => setForm({ ...form, insurance_provider: e.target.value })} placeholder="نام بیمه" /></Field>
        <Field label="شماره بیمه"><Input value={form.insurance_number} onChange={(e) => setForm({ ...form, insurance_number: e.target.value })} placeholder="شماره بیمه" /></Field>
      </div>
      <Field label="یادداشت"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="یادداشت..." /></Field>
      {formError && <p className="text-xs text-red-500 px-1">{formError}</p>}
      <Button onClick={submit} color="#10B981" disabled={saving} className="w-full">{saving ? 'در حال ذخیره...' : 'ذخیره پرونده بیمار'}</Button>
    </div>
  );
}

// ==================== INFO TAB (WITH V15 4-STATE ALLERGY VERIFICATION) ====================
export function InfoTab({ patient }: { patient: Patient }) {
  const effectiveRole = getRuntimeServerVerifiedRole() || 'manager';
  const [structuredReviews, setStructuredReviews] = useState<StructuredAllergyReview[] | undefined>(() =>
    getPatientAllergyReviews(patient.id)
  );
  const [verificationStatus, setVerificationStatus] = useState<AllergyVerificationStatus>('not_asked');
  const [substanceInput, setSubstanceInput] = useState(patient.allergies ?? '');
  const [severityInput, setSeverityInput] = useState<'mild' | 'moderate' | 'life_threatening'>('moderate');
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

  useEffect(() => {
    hydratePatientClinicalRecordFromServer(patient.id).then(() => {
      setStructuredReviews(getPatientAllergyReviews(patient.id));
    });
  }, [patient.id]);

  const safetyAssessment = assessPatientAllergySafety(patient, structuredReviews);

  const handleSaveAllergyReview = async () => {
    const res = await persistStructuredAllergyReviewCommand({
      patientId: patient.id,
      activeContextPatientId: patient.id,
      status: verificationStatus,
      substanceAgent: verificationStatus === 'present' ? substanceInput.trim() : null,
      severity: verificationStatus === 'present' ? severityInput : null,
      certainty: ['manager', 'dentist'].includes(effectiveRole)
        ? 'confirmed_by_clinician'
        : 'unconfirmed',
      reviewedBy: 'دکتر مهدی امیری',
      reviewerRole: effectiveRole,
    });
    if (res.ok && res.review) {
      setStructuredReviews(getPatientAllergyReviews(patient.id));
      setReviewNotice(
        res.persistenceStatus === 'persisted_server'
          ? 'وضعیت حساسیت دارویی بیمار به‌صورت ساختاریافته در سرور ثبت و تأیید شد.'
          : 'بررسی حساسیت به‌صورت پیش‌نویس محلی ذخیره شد (در انتظار همگام‌سازی سرور).'
      );
    } else {
      setReviewNotice(res.errorMessageFa || 'ثبت بررسی حساسیت انجام نشد.');
    }
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2.5" data-testid="v15_allergy_verification_card">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
            <AlertCircle size={15} className="text-emerald-600" />
            <span>وضعیت ساختاریافته حساسیت دارویی (FHIR AllergyIntolerance):</span>
          </div>
          <span
            data-testid="v15_allergy_status_badge"
            className={`text-[10.5px] font-black px-2.5 py-0.5 rounded-xl border ${
              safetyAssessment.verificationStatus === 'present'
                ? 'bg-red-100 text-red-800 border-red-300'
                : safetyAssessment.verificationStatus === 'no_known'
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                : 'bg-amber-100 text-amber-800 border-amber-300'
            }`}
          >
            {safetyAssessment.verificationLabelFa}
          </span>
        </div>

        {safetyAssessment.assistiveDisclaimerFa && (
          <p className="text-[10.5px] text-slate-600 leading-relaxed">{safetyAssessment.assistiveDisclaimerFa}</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {([
            { id: 'not_asked', label: 'هنوز پرسیده نشده' },
            { id: 'unknown', label: 'نامشخص برای بیمار' },
            { id: 'no_known', label: 'فاقد حساسیت (NKA)' },
            { id: 'present', label: 'دارای حساسیت ثبت‌شده' },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setVerificationStatus(opt.id)}
              className={`py-1.5 px-2 rounded-xl text-[10.5px] font-extrabold border transition-all ${
                verificationStatus === opt.id
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {verificationStatus === 'present' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <Input
              value={substanceInput}
              onChange={(e) => setSubstanceInput(e.target.value)}
              placeholder="نام دارو یا ماده حساسیت‌زا (مثلاً پنی‌سیلین، لیدوکائین)"
              className="text-xs"
            />
            <Select
              value={severityInput}
              onChange={(e) => setSeverityInput(e.target.value as 'mild' | 'moderate' | 'life_threatening')}
              options={[
                { value: 'mild', label: 'خفیف (Mild)' },
                { value: 'moderate', label: 'متوسط (Moderate)' },
                { value: 'life_threatening', label: 'خطر آنافیلاکسی (Life-Threatening)' },
              ]}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[10px] text-slate-500">فیلد خالی هرگز به‌معنای «فاقد حساسیت» تفسیر نمی‌شود.</span>
          <button
            type="button"
            onClick={handleSaveAllergyReview}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold shadow-sm"
          >
            ثبت تأیید حساسیت
          </button>
        </div>
        {reviewNotice && (
          <p className="text-[10.5px] font-bold text-emerald-800 bg-white/80 rounded-xl px-2.5 py-1.5 border border-emerald-200">
            {reviewNotice}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {patient.phone && <InfoItem icon={<Phone size={14} />} label="تلفن" value={patient.phone} />}
        {patient.national_id && <InfoItem icon={<FileText size={14} />} label="کد ملی" value={patient.national_id} />}
        {patient.birth_date && <InfoItem icon={<Calendar size={14} />} label="تولد" value={patient.birth_date} />}
        {patient.blood_type && <InfoItem icon={<Heart size={14} />} label="گروه خونی" value={patient.blood_type} />}
        {patient.insurance_provider && <InfoItem icon={<Shield size={14} />} label="بیمه" value={patient.insurance_provider} />}
      </div>
      {patient.allergies && <DetailBlock icon={<AlertCircle size={14} />} color="#EF4444" label="حساسیت‌ها (یادداشت بیمار)" value={patient.allergies} />}
      {patient.medical_history && <DetailBlock icon={<Heart size={14} />} color="#8B5CF6" label="سابقه پزشکی" value={patient.medical_history} />}
      {patient.medications && <DetailBlock icon={<Pill size={14} />} color="#3B82F6" label="داروها" value={patient.medications} />}
      {patient.address && <DetailBlock icon={<FileText size={14} />} color="#6B7280" label="آدرس" value={patient.address} />}
      {patient.notes && <DetailBlock icon={<FileText size={14} />} color="#6B7280" label="یادداشت" value={patient.notes} />}
    </div>
  );
}

// ==================== TREATMENTS TAB (VERIFIED WRITES + CLINICAL NOTES LIFECYCLE) ====================
export function TreatmentsTab({ patientId, treatments }: { patientId: string; treatments: Treatment[] }) {
  const effectiveRole = getRuntimeServerVerifiedRole() || 'manager';
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ diagnosis: '', treatment_plan: '', tooth_numbers: '', total_cost: '', status: 'planned' });

  const save = async () => {
    if (!form.diagnosis.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    const res = await supabase.from('treatments').insert({
      patient_id: patientId,
      diagnosis: form.diagnosis,
      treatment_plan: form.treatment_plan || null,
      tooth_numbers: form.tooth_numbers || null,
      total_cost: Number(form.total_cost) || 0,
      paid_amount: 0,
      status: form.status,
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') {
      setErrorMsg('ثبت درمان انجام نشد. فرم باز نگه داشته شد تا اطلاعات شما از دست نرود.');
      return;
    }
    setShowForm(false);
    setForm({ diagnosis: '', treatment_plan: '', tooth_numbers: '', total_cost: '', status: 'planned' });
  };

  const del = async (id: string) => {
    const res = await supabase.from('treatments').delete().eq('id', id);
    if (getMutationOutcome(res) === 'error') setErrorMsg('حذف درمان انجام نشد.');
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="درمان‌ها" count={treatments.length} onAdd={() => setShowForm(true)} color="#8B5CF6" icon={<Stethoscope size={16} />} />
      {errorMsg && <p className="text-xs text-red-600 bg-red-50 p-2 rounded-xl border border-red-200">{errorMsg}</p>}
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت سریع درمان برای بیمار" icon={<Stethoscope size={20} />} color="#8B5CF6">
        <div className="space-y-4">
          <Field label="تشخیص"><Input value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} placeholder="تشخیص بیماری..." /></Field>
          <Field label="طرح درمان"><Textarea rows={2} value={form.treatment_plan} onChange={(e) => setForm({ ...form, treatment_plan: e.target.value })} placeholder="شرح درمان..." /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="دندان‌ها (FDI)"><Input value={form.tooth_numbers} onChange={(e) => setForm({ ...form, tooth_numbers: e.target.value })} placeholder="مثلاً ۱۶، ۱۷" /></Field>
            <Field label="هزینه (تومان)"><Input type="number" value={form.total_cost} onChange={(e) => setForm({ ...form, total_cost: e.target.value })} placeholder="0" /></Field>
          </div>
          <Field label="وضعیت"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={TREATMENT_STATUS} /></Field>
          {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
          <Button color="#8B5CF6" disabled={saving || !form.diagnosis.trim()} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت درمان'}</Button>
        </div>
      </Sheet>

      {treatments.length === 0 ? <EmptyHint text="درمانی ثبت نشده — روی + درمان جدید را ثبت کنید" /> : treatments.map((t) => (
        <div key={t.id} className="glass-card p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-bold text-gray-700">{t.diagnosis ?? 'بدون تشخیص'}</p>
            <div className="flex items-center gap-2">
              <Badge color="#8B5CF6" bg="#EDE9FE">{TREATMENT_STATUS.find((s) => s.value === t.status)?.label ?? t.status}</Badge>
              <DeleteBtn onClick={() => del(t.id)} />
            </div>
          </div>
          {t.tooth_numbers && <p className="text-xs text-gray-400">دندان: {t.tooth_numbers}</p>}
          {t.treatment_plan && <p className="text-xs text-gray-500 mt-1">{t.treatment_plan}</p>}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <span className="text-xs font-bold text-violet-600">{Number(t.total_cost).toLocaleString('fa-IR')} ت</span>
            <span className="text-xs text-gray-400">{toJalaliStr(t.created_at.slice(0, 10))}</span>
          </div>
        </div>
      ))}

      <ClinicalNotesPanel patientId={patientId} effectiveRole={effectiveRole} />
    </div>
  );
}
