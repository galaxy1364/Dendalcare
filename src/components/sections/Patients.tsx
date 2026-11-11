import { useState, useMemo } from 'react';
import {
  Users, Search, Plus, Phone, Calendar, Heart, AlertCircle,
  Pill, FileText, Shield, Activity, Stethoscope, Wallet,
  FlaskConical, Anchor, BellRing, CreditCard, ScrollText,
  CheckCircle2, Clock, TrendingUp, ArrowDownCircle,
  ArrowUpCircle, CalendarClock, Trash2,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase,
  type Patient, type Treatment, type Payment,
  type LabOrder, type Implant, type Reminder,
  type Installment, type Check as CheckType, type Safteh,
} from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState, Loading } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { PalmerChart } from '@/components/PalmerChart';
import { PatientGalleryModal } from '@/components/ui/PatientGalleryModal';
import { PrintInvoiceModal } from '@/components/ui/PrintInvoiceModal';
import { ConsentModal } from '@/components/ui/ConsentModal';
import { Camera, Printer, FileSpreadsheet, AlertTriangle, FileSignature } from 'lucide-react';
import { exportToCsv } from '@/lib/exportUtils';
import { detectMedicalAlerts } from '@/lib/medicalAlerts';

const GENDER_OPTIONS = [
  { value: 'male', label: 'مرد' },
  { value: 'female', label: 'زن' },
  { value: 'unknown', label: 'نامشخص' },
];
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقدی' },
  { value: 'card', label: 'کارت' },
  { value: 'transfer', label: 'انتقال بانکی' },
  { value: 'insurance', label: 'بیمه' },
  { value: 'installment', label: 'اقساط' },
];

const TREATMENT_STATUS = [
  { value: 'planned', label: 'برنامه‌ریزی' },
  { value: 'in_progress', label: 'در حال انجام' },
  { value: 'completed', label: 'تکمیل‌شده' },
  { value: 'cancelled', label: 'لغوشده' },
];

const LAB_WORK_TYPES = [
  { value: 'crown', label: 'روکش' },
  { value: 'bridge', label: 'پل' },
  { value: 'denture', label: 'دنچر' },
  { value: 'implant_abutment', label: 'اباتمان ایمپلنت' },
  { value: 'orthodontic_appliance', label: 'اپلاینس ارتودنسی' },
  { value: 'splint', label: 'اسپلینت' },
  { value: 'other', label: 'سایر' },
];

const IMPLANT_STAGES = [
  { value: 'planning', label: 'برنامه‌ریزی' },
  { value: 'extraction_and_graft', label: 'کشیدن و پیوند' },
  { value: 'implant_placement', label: 'جایگذاری ایمپلنت' },
  { value: 'osseointegration', label: 'ادغام استخوان' },
  { value: 'abutment_placement', label: 'قرارگیری اباتمان' },
  { value: 'crown_fitting', label: 'نصب روکش' },
  { value: 'completed', label: 'تکمیل‌شده' },
  { value: 'failed', label: 'ناموفق' },
];

const REMINDER_CATEGORIES = [
  { value: 'appointment', label: 'نوبت' },
  { value: 'treatment', label: 'درمان' },
  { value: 'lab', label: 'لابراتوار' },
  { value: 'implant', label: 'ایمپلنت' },
  { value: 'payment', label: 'پرداخت' },
  { value: 'follow_up', label: 'ویزیت مجدد' },
  { value: 'other', label: 'سایر' },
];

const REMINDER_PRIORITIES = [
  { value: 'low', label: 'کم' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'زیاد' },
  { value: 'urgent', label: 'فوری' },
];

const CHECK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'در جریان', color: '#F59E0B', bg: '#FEF3C7' },
  cleared: { label: 'وصول‌شده', color: '#22C55E', bg: '#DCFCE7' },
  bounced: { label: 'برگشت‌خورده', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'باطل‌شده', color: '#9CA3AF', bg: '#F3F4F6' },
};

const INSTALLMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'فعال', color: '#3B82F6', bg: '#DBEAFE' },
  completed: { label: 'تکمیل‌شده', color: '#22C55E', bg: '#DCFCE7' },
  overdue: { label: 'معوق', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'لغوشده', color: '#9CA3AF', bg: '#F3F4F6' },
};

const LAB_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  sent: { label: 'ارسال‌شده', color: '#3B82F6', bg: '#DBEAFE' },
  in_progress: { label: 'در حال ساخت', color: '#F59E0B', bg: '#FEF3C7' },
  received: { label: 'دریافت‌شده', color: '#22C55E', bg: '#DCFCE7' },
  delivered_to_patient: { label: 'تحویل بیمار', color: '#8B5CF6', bg: '#EDE9FE' },
  cancelled: { label: 'لغوشده', color: '#EF4444', bg: '#FEE2E2' },
};

type PatientTab = 'info' | 'chart' | 'treatments' | 'payments' | 'installments' | 'checks' | 'safteh' | 'lab' | 'implants' | 'reminders';

export function Patients() {
  const { data: patients, loading, refresh } = useRealtimeTable<Patient>('patients');
  const { data: treatments } = useRealtimeTable<Treatment>('treatments');
  const { data: payments } = useRealtimeTable<Payment>('payments');
  const { data: labOrders } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: implants } = useRealtimeTable<Implant>('implants');
  const { data: reminders } = useRealtimeTable<Reminder>('reminders');
  const { data: installments } = useRealtimeTable<Installment>('installments');
  const { data: checks } = useRealtimeTable<CheckType>('checks');
  const { data: safteh } = useRealtimeTable<Safteh>('safteh');

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [chipFilter, setChipFilter] = useState<'all' | 'active_treat' | 'lab' | 'implant' | 'checks_inst' | 'debtors'>('all');
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailPatient, setDetailPatient] = useState<Patient | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  const getPatientFileNo = (p: Patient, idx?: number) => {
    const match = p.notes?.match(/\[پرونده:\s*([^\]]+)\]/);
    if (match?.[1]) return match[1].trim();
    if (p.insurance_number?.trim()) return p.insurance_number.trim();
    if (p.national_id?.trim()) return `P-${p.national_id.slice(-4)}`;
    return `${1001 + (idx ?? 0)}`;
  };

  const filtered = useMemo(() => {
    let list = patients;
    if (chipFilter === 'active_treat') {
      list = list.filter(p => treatments.some(t => t.patient_id === p.id && (t.status === 'in_progress' || t.status === 'planned')));
    } else if (chipFilter === 'lab') {
      list = list.filter(p => labOrders.some(l => l.patient_id === p.id));
    } else if (chipFilter === 'implant') {
      list = list.filter(p => implants.some(im => im.patient_id === p.id));
    } else if (chipFilter === 'checks_inst') {
      list = list.filter(p =>
        installments.some(i => i.patient_id === p.id && i.status === 'active') ||
        checks.some(c => c.patient_id === p.id && c.status === 'pending')
      );
    } else if (chipFilter === 'debtors') {
      list = list.filter(p => {
        const cost = treatments.filter(t => t.patient_id === p.id).reduce((s, t) => s + Number(t.total_cost), 0);
        const paid = payments.filter(pay => pay.patient_id === p.id).reduce((s, pay) => s + Number(pay.amount), 0);
        return cost - paid > 0;
      });
    }

    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p, idx) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      p.phone?.includes(q) ||
      p.national_id?.includes(q) ||
      getPatientFileNo(p, idx).toLowerCase().includes(q)
    );
  }, [patients, treatments, labOrders, implants, installments, checks, payments, search, chipFilter]);

  const handleSave = async (data: Partial<Patient>): Promise<boolean> => {
    setSaving(true);
    const result = editing
      ? await supabase.from('patients').update(data).eq('id', editing.id)
      : await supabase.from('patients').insert(data);
    setSaving(false);
    if (result.error) return false;
    setFormOpen(false);
    setEditing(null);
    setActionError(null);
    refresh();
    return true;
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('patients').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      setActionError('حذف بیمار انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  const handleExportCsv = () => {
    const rows = patients.map((p, idx) => {
      const pTreatments = treatments.filter((t) => t.patient_id === p.id);
      const pPayments = payments.filter((pay) => pay.patient_id === p.id);
      const totalPaid = pPayments.reduce((s, pay) => s + Number(pay.amount), 0);
      const totalCost = pTreatments.reduce((s, t) => s + Number(t.total_cost), 0);
      return {
        file_no: getPatientFileNo(p, idx),
        first_name: p.first_name,
        last_name: p.last_name,
        national_id: p.national_id || '',
        phone: p.phone || '',
        gender: p.gender === 'female' ? 'زن' : p.gender === 'male' ? 'مرد' : 'نامشخص',
        insurance: p.insurance_provider || 'آزاد',
        total_cost: totalCost,
        total_paid: totalPaid,
        balance: totalCost - totalPaid,
        status: p.status === 'active' ? 'فعال' : 'غیرفعال',
      };
    });

    exportToCsv(
      `MinaDental_Patients_${new Date().toISOString().slice(0, 10)}`,
      rows,
      [
        { key: 'file_no', label: 'شماره پرونده' },
        { key: 'first_name', label: 'نام' },
        { key: 'last_name', label: 'نام خانوادگی' },
        { key: 'national_id', label: 'کد ملی' },
        { key: 'phone', label: 'شماره تماس' },
        { key: 'gender', label: 'جنسیت' },
        { key: 'insurance', label: 'بیمه' },
        { key: 'total_cost', label: 'هزینه کل (تومان)' },
        { key: 'total_paid', label: 'پرداخت شده (تومان)' },
        { key: 'balance', label: 'مانده حساب (تومان)' },
        { key: 'status', label: 'وضعیت پرونده' },
      ]
    );
  };

  if (loading) return <Loading color="#10B981" />;

  return (
    <div className="space-y-2.5 pb-32 animate-fade-in-up">
      {/* ── QBank Sliding Horizontal Chip Bar + Expandable Magnifier Search ── */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          {/* Expandable Animated Magnifying Glass Button */}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen || search
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
            title="جستجوی سریع بیمار، موبایل یا شماره پرونده"
            aria-label="جستجوی بیمار"
          >
            <Search size={17} />
          </button>

          {/* Horizontal Sliding Chip Bar for All Patient Sub-Views */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {[
              { id: 'all' as const, label: 'همه پرونده‌ها', count: patients.length, color: '#059669' },
              {
                id: 'active_treat' as const,
                label: 'درمان فعال',
                count: patients.filter(p => treatments.some(t => t.patient_id === p.id && t.status !== 'completed')).length,
                color: '#7C3AED',
              },
              {
                id: 'lab' as const,
                label: 'دارای لابراتوار',
                count: patients.filter(p => labOrders.some(l => l.patient_id === p.id)).length,
                color: '#DB2777',
              },
              {
                id: 'implant' as const,
                label: 'دارای ایمپلنت',
                count: patients.filter(p => implants.some(im => im.patient_id === p.id)).length,
                color: '#0891B2',
              },
              {
                id: 'checks_inst' as const,
                label: 'چک و اقساط',
                count: patients.filter(p =>
                  installments.some(i => i.patient_id === p.id && i.status === 'active') ||
                  checks.some(c => c.patient_id === p.id && c.status === 'pending')
                ).length,
                color: '#D97706',
              },
              {
                id: 'debtors' as const,
                label: 'بدهکاران',
                count: patients.filter(p => {
                  const c = treatments.filter(t => t.patient_id === p.id).reduce((s, t) => s + Number(t.total_cost), 0);
                  const pd = payments.filter(pay => pay.patient_id === p.id).reduce((s, pay) => s + Number(pay.amount), 0);
                  return c - pd > 0;
                }).length,
                color: '#E11D48',
              },
            ].map(ch => {
              const active = chipFilter === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => setChipFilter(ch.id)}
                  className={`px-3 py-1.5 rounded-2xl text-[11px] font-extrabold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 haptic ${
                    active ? 'text-white shadow-md scale-[1.02]' : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/70'
                  }`}
                  style={active ? { background: ch.color } : undefined}
                >
                  <span>{ch.label}</span>
                  <span
                    className={`text-[9.5px] px-1.5 py-0.2 rounded-full ${
                      active ? 'bg-white/25 text-white' : 'bg-white text-gray-500'
                    }`}
                  >
                    {ch.count.toLocaleString('fa-IR')}
                  </span>
                </button>
              );
            })}

            <button
              onClick={handleExportCsv}
              className="px-2.5 py-1.5 rounded-2xl bg-sky-50 text-sky-700 border border-sky-200 text-[11px] font-extrabold whitespace-nowrap flex items-center gap-1 shrink-0 haptic"
              title="خروجی اکسل پرونده‌ها"
            >
              <FileSpreadsheet size={13} />
              <span>اکسل</span>
            </button>
          </div>

          {/* Quick New Patient Action */}
          <button
            onClick={() => { setEditing(null); setFormOpen(true); }}
            className="w-9 h-9 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            aria-label="پرونده بیمار جدید"
            title="ثبت پرونده بیمار جدید"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Animated Collapsible Search Box */}
        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" />
              <Input
                autoFocus
                placeholder="جستجو با نام، شماره پرونده، موبایل یا کد ملی..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {actionError && <p className="text-xs text-red-500 bg-red-50 rounded-xl p-2.5">{actionError}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<Users size={28} />} title="پرونده‌ای یافت نشد" subtitle="برای تشکیل پرونده جدید روی دکمه + بزنید" color="#10B981" />
      ) : (
        <div className="space-y-2.5 stagger">
          {filtered.map((patient, idx) => {
            const pTreatments = treatments.filter(t => t.patient_id === patient.id);
            const pPayments = payments.filter(p => p.patient_id === patient.id);
            const pLabs = labOrders.filter(l => l.patient_id === patient.id);
            const pImplants = implants.filter(im => im.patient_id === patient.id);
            const totalPaid = pPayments.reduce((s, p) => s + Number(p.amount), 0);
            const totalCost = pTreatments.reduce((s, t) => s + Number(t.total_cost), 0);
            const balance = totalCost - totalPaid;
            const pInstallments = installments.filter(i => i.patient_id === patient.id && i.status === 'active');
            const pChecks = checks.filter(c => c.patient_id === patient.id && c.status === 'pending');
            const medicalAlerts = detectMedicalAlerts(`${patient.allergies || ''} ${patient.medical_history || ''} ${patient.medications || ''}`);
            const fileNo = getPatientFileNo(patient, idx);
            const isExpanded = expandedCardId === patient.id;

            // Compute Live Clinical Progress Stage for the Patient Card Timeline
            const hasTreatments = pTreatments.length > 0;
            const hasCompletedTreat = pTreatments.some(t => t.status === 'completed');
            const hasActiveLabOrImp = pLabs.some(l => l.status !== 'delivered_to_patient') || pImplants.some(i => i.stage !== 'completed');
            const isFinanciallySettled = totalCost > 0 && balance <= 0;

            const timelineSteps = [
              { label: 'تشکیل پرونده', done: true, active: !hasTreatments, color: '#10B981' },
              { label: `درمان (${pTreatments.length.toLocaleString('fa-IR')})`, done: hasCompletedTreat, active: hasTreatments && !hasCompletedTreat, color: '#8B5CF6' },
              { label: `لابراتوار/ایمپلنت (${(pLabs.length + pImplants.length).toLocaleString('fa-IR')})`, done: (pLabs.length + pImplants.length) > 0 && !hasActiveLabOrImp, active: hasActiveLabOrImp, color: '#EC4899' },
              { label: balance > 0 ? 'بدهکار' : 'تسویه مالی', done: isFinanciallySettled, active: balance > 0, color: balance > 0 ? '#EF4444' : '#22C55E' },
            ];

            return (
              <div key={patient.id} className="glass-card p-3.5 transition-all">
                {/* Main Top Row — Clean Non-Overlapping Hierarchy */}
                <div className="flex items-start justify-between gap-2.5">
                  <div
                    onClick={() => setDetailPatient(patient)}
                    className="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer"
                  >
                    <div
                      className="w-11 h-11 rounded-2xl flex flex-col items-center justify-center text-white font-black text-sm shrink-0 shadow-sm"
                      style={{ background: patient.gender === 'female' ? 'linear-gradient(135deg,#EC4899,#DB2777)' : 'linear-gradient(135deg,#10B981,#059669)' }}
                    >
                      <span>{patient.first_name[0]}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1.5">
                        <h3 className="text-sm font-black text-slate-800 truncate">
                          {patient.first_name} {patient.last_name}
                        </h3>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          پرونده #{fileNo}
                        </span>
                        {medicalAlerts.length > 0 && (
                          <span className="flex items-center gap-0.5 text-[9.5px] font-extrabold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-lg shrink-0">
                            <AlertTriangle size={10} /> {medicalAlerts[0].titleFa.split('(')[0]}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center flex-wrap gap-2.5 mt-1 text-[11px] text-gray-500">
                        {patient.phone && (
                          <span className="flex items-center gap-1 font-semibold" dir="ltr">
                            <Phone size={11} className="text-emerald-600" />
                            {patient.phone}
                          </span>
                        )}
                        {pInstallments.length > 0 && (
                          <span className="flex items-center gap-0.5 text-blue-600 font-bold">
                            <CreditCard size={11} /> {pInstallments.length.toLocaleString('fa-IR')} قسط
                          </span>
                        )}
                        {pChecks.length > 0 && (
                          <span className="flex items-center gap-0.5 text-amber-600 font-bold">
                            <ScrollText size={11} /> {pChecks.length.toLocaleString('fa-IR')} چک
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Financial Status Pill (Zero Overlap) */}
                  <div className="text-left shrink-0 flex flex-col items-end">
                    {balance > 0 ? (
                      <span className="px-2.5 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-[11px] font-black">
                        مانده: {balance.toLocaleString('fa-IR')} ت
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-black">
                        تسویه کامل
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        onClick={() => setExpandedCardId(isExpanded ? null : patient.id)}
                        className="text-[10px] font-extrabold text-purple-600 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded-lg transition-colors"
                      >
                        {isExpanded ? 'بستن ریز پرونده ▲' : 'ریز روند و دندان ▼'}
                      </button>
                      <button
                        onClick={() => setDetailPatient(patient)}
                        className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg transition-colors"
                      >
                        پرونده کامل ←
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Interactive Clinical Progress Line on Patient Card */}
                <div className="mt-2.5 pt-2 border-t border-gray-100">
                  <div className="grid grid-cols-4 gap-1">
                    {timelineSteps.map((st, sIdx) => (
                      <div
                        key={sIdx}
                        onClick={() => setDetailPatient(patient)}
                        className="cursor-pointer rounded-xl px-1.5 py-1 text-center transition-all"
                        style={{
                          background: st.done ? `${st.color}18` : st.active ? `${st.color}15` : '#F8FAFC',
                          border: st.active ? `1px solid ${st.color}` : '1px solid transparent',
                        }}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: st.done || st.active ? st.color : '#CBD5E1' }}
                          />
                          <span
                            className="text-[9.5px] font-extrabold truncate"
                            style={{ color: st.done || st.active ? st.color : '#94A3B8' }}
                          >
                            {st.label}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Collapsible Complete Summary on Card (Treatments, Teeth, Doctor, Lab, Implants, Finance) */}
                {isExpanded && (
                  <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200 space-y-2 animate-fade-in">
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="rounded-xl bg-slate-50 p-1.5">
                        <p className="text-[9px] text-gray-400">جمع کل درمان</p>
                        <p className="text-xs font-black text-slate-700">{totalCost.toLocaleString('fa-IR')} ت</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50/70 p-1.5">
                        <p className="text-[9px] text-emerald-600">پرداختی بیمار</p>
                        <p className="text-xs font-black text-emerald-700">{totalPaid.toLocaleString('fa-IR')} ت</p>
                      </div>
                      <div className="rounded-xl bg-rose-50/70 p-1.5">
                        <p className="text-[9px] text-rose-500">مانده بدهی</p>
                        <p className="text-xs font-black text-rose-600">{balance.toLocaleString('fa-IR')} ت</p>
                      </div>
                    </div>

                    {pTreatments.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-extrabold text-violet-700">لیست درمان‌ها، دندان و پزشک معالج:</p>
                        {pTreatments.slice(0, 3).map(t => (
                          <div key={t.id} className="flex items-center justify-between bg-violet-50/60 rounded-xl px-2.5 py-1.5 text-[10.5px]">
                            <div className="min-w-0 flex-1">
                              <span className="font-extrabold text-slate-800">{t.diagnosis || 'درمان دندانپزشکی'}</span>
                              {t.tooth_numbers && <span className="text-violet-700 font-bold mr-1.5">• دندان {t.tooth_numbers}</span>}
                              <span className="text-gray-500 mr-1.5">• دکتر مهدی امیری</span>
                            </div>
                            <span className="font-black text-violet-700 shrink-0">{Number(t.total_cost).toLocaleString('fa-IR')} ت</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {(pLabs.length > 0 || pImplants.length > 0) && (
                      <div className="flex flex-wrap gap-1.5">
                        {pLabs.map(l => (
                          <span key={l.id} className="text-[10px] font-bold bg-pink-50 text-pink-700 border border-pink-200 px-2 py-0.5 rounded-lg">
                            لابراتوار ({l.lab_name || 'پروتز'}): {LAB_STATUS[l.status]?.label || l.status}
                          </span>
                        ))}
                        {pImplants.map(im => (
                          <span key={im.id} className="text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded-lg">
                            ایمپلنت دندان {im.tooth_number || '-'}: {IMPLANT_STAGES.find(s => s.value === im.stage)?.label || im.stage}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} title={editing ? 'ویرایش پرونده بیمار' : 'تشکیل پرونده بیمار جدید'} icon={<Users size={20} />} color="#10B981">
        <PatientForm patient={editing} nextFileNo={String(1001 + patients.length)} onSave={handleSave} saving={saving} />
      </Sheet>

      <Sheet open={!!detailPatient} onClose={() => setDetailPatient(null)} title={detailPatient ? `${detailPatient.first_name} ${detailPatient.last_name}` : ''} icon={<Users size={20} />} color="#10B981">
        {detailPatient && (
          <PatientDetail
            patient={detailPatient}
            treatments={treatments.filter(t => t.patient_id === detailPatient.id)}
            payments={payments.filter(p => p.patient_id === detailPatient.id)}
            labOrders={labOrders.filter(l => l.patient_id === detailPatient.id)}
            implants={implants.filter(i => i.patient_id === detailPatient.id)}
            reminders={reminders.filter(r => r.patient_id === detailPatient.id)}
            installments={installments.filter(i => i.patient_id === detailPatient.id)}
            checks={checks.filter(c => c.patient_id === detailPatient.id)}
            safteh={safteh.filter(s => s.patient_id === detailPatient.id)}
            onEdit={() => { setEditing(detailPatient); setDetailPatient(null); setFormOpen(true); }}
            onDelete={() => { setDeleteId(detailPatient.id); setDetailPatient(null); }}
            onOpenGallery={() => setGalleryOpen(true)}
            onOpenPrint={() => setPrintOpen(true)}
            onOpenConsent={() => setConsentOpen(true)}
          />
        )}
      </Sheet>

      <PatientGalleryModal
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        patient={detailPatient}
      />

      <PrintInvoiceModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        patient={detailPatient}
        treatments={treatments.filter(t => t.patient_id === detailPatient?.id)}
      />

      <ConsentModal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        patient={detailPatient}
      />

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="حذف بیمار" message="آیا از حذف این بیمار و تمام اطلاعات مرتبط اطمینان دارید؟ این عملیات قابل بازگشت نیست." confirmLabel="حذف" />
    </div>
  );
}

// ==================== PATIENT FORM ====================
function PatientForm({ patient, nextFileNo, onSave, saving }: { patient: Patient | null; nextFileNo: string; onSave: (d: Partial<Patient>) => Promise<boolean>; saving: boolean }) {
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
          <Input value={fileNo} onChange={e => setFileNo(e.target.value)} placeholder="مثلاً 1001" className="font-mono font-bold text-emerald-700 bg-emerald-50/50" />
        </Field>
        <Field label="نام"><Input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} placeholder="نام" /></Field>
        <Field label="نام خانوادگی"><Input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} placeholder="نام خانوادگی" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="کد ملی"><Input value={form.national_id} onChange={e => setForm({ ...form, national_id: e.target.value })} placeholder="کد ملی" /></Field>
        <Field label="تلفن همراه"><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0912..." /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ تولد"><JalaliDatePicker value={form.birth_date} onChange={v => setForm({ ...form, birth_date: v })} /></Field>
        <Field label="جنسیت"><Select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value as 'male' | 'female' | 'unknown' })} options={GENDER_OPTIONS} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="گروه خونی"><Select value={form.blood_type} onChange={e => setForm({ ...form, blood_type: e.target.value })} options={[{ value: '', label: 'نامشخص' }, ...BLOOD_TYPES.map(b => ({ value: b, label: b }))]} /></Field>
        <Field label="ایمیل"><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="ایمیل" /></Field>
      </div>
      <Field label="آدرس"><Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} placeholder="آدرس" /></Field>
      <Field label="حساسیت‌ها"><Textarea value={form.allergies} onChange={e => setForm({ ...form, allergies: e.target.value })} rows={2} placeholder="حساسیت‌های غذایی، دارویی..." /></Field>
      <Field label="سابقه پزشکی"><Textarea value={form.medical_history} onChange={e => setForm({ ...form, medical_history: e.target.value })} rows={2} placeholder="بیماری‌های زمینه‌ای..." /></Field>
      <Field label="داروهای مصرفی"><Textarea value={form.medications} onChange={e => setForm({ ...form, medications: e.target.value })} rows={2} placeholder="داروهای فعلی..." /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="بیمه"><Input value={form.insurance_provider} onChange={e => setForm({ ...form, insurance_provider: e.target.value })} placeholder="نام بیمه" /></Field>
        <Field label="شماره بیمه"><Input value={form.insurance_number} onChange={e => setForm({ ...form, insurance_number: e.target.value })} placeholder="شماره بیمه" /></Field>
      </div>
      <Field label="یادداشت"><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="یادداشت..." /></Field>
      {formError && <p className="text-xs text-red-500 px-1">{formError}</p>}
      <Button onClick={submit} color="#10B981" disabled={saving} className="w-full">{saving ? 'در حال ذخیره...' : 'ذخیره پرونده بیمار'}</Button>
    </div>
  );
}

// ==================== SHARED UI HELPERS ====================
function SectionHeader({ title, count, onAdd, color, icon }: { title: string; count: number; onAdd: () => void; color: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, color }}>{icon}</div>
        <h3 className="text-sm font-bold text-gray-700">{title}</h3>
        {count > 0 && <Badge color={color} bg={`${color}15`}>{count}</Badge>}
      </div>
      <button onClick={onAdd} className="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow haptic transition-transform" style={{ background: color }}>
        <Plus size={18} />
      </button>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-gray-400 text-center py-6">{text}</p>;
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1">{icon}<span className="text-[10px]">{label}</span></div>
      <p className="text-sm font-semibold text-gray-700">{value}</p>
    </div>
  );
}

function DetailBlock({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color }}>{icon}<span className="text-xs font-bold">{label}</span></div>
      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 haptic"><Trash2 size={13} /></button>;
}

// ==================== PATIENT DETAIL HUB ====================
function PatientDetail({
  patient, treatments, payments, labOrders, implants, reminders, installments, checks, safteh, onEdit, onDelete,
  onOpenGallery, onOpenPrint, onOpenConsent,
}: {
  patient: Patient; treatments: Treatment[]; payments: Payment[];
  labOrders: LabOrder[]; implants: Implant[]; reminders: Reminder[];
  installments: Installment[]; checks: CheckType[]; safteh: Safteh[];
  onEdit: () => void; onDelete: () => void;
  onOpenGallery: () => void; onOpenPrint: () => void; onOpenConsent: () => void;
}) {
  const [tab, setTab] = useState<PatientTab>('info');
  const totalCost = treatments.reduce((s, t) => s + Number(t.total_cost), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = totalCost - totalPaid;
  const installmentDebt = installments.filter(i => i.status === 'active').reduce((s, i) => s + (Number(i.total_amount) - Number(i.paid_amount)), 0);
  const pendingChecks = checks.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.amount), 0);

  const tabs: { id: PatientTab; label: string; icon: typeof Heart; color: string; count?: number }[] = [
    { id: 'info', label: 'اطلاعات', icon: FileText, color: '#10B981' },
    { id: 'chart', label: 'چارت', icon: Activity, color: '#06B6D4' },
    { id: 'treatments', label: 'درمان', icon: Stethoscope, color: '#8B5CF6', count: treatments.length },
    { id: 'payments', label: 'پرداخت', icon: Wallet, color: '#22C55E', count: payments.length },
    { id: 'installments', label: 'اقساط', icon: CreditCard, color: '#3B82F6', count: installments.length },
    { id: 'checks', label: 'چک‌ها', icon: ScrollText, color: '#F59E0B', count: checks.length },
    { id: 'safteh', label: 'سفته', icon: ScrollText, color: '#6366F1', count: safteh.length },
    { id: 'lab', label: 'لابراتوار', icon: FlaskConical, color: '#EC4899', count: labOrders.length },
    { id: 'implants', label: 'ایمپلنت', icon: Anchor, color: '#06B6D4', count: implants.length },
    { id: 'reminders', label: 'یادآوری', icon: BellRing, color: '#EF4444', count: reminders.length },
  ];

  const medicalAlerts = detectMedicalAlerts(`${patient.allergies || ''} ${patient.medical_history || ''} ${patient.medications || ''}`);

  return (
    <div className="space-y-4">
      {/* High-Risk Medical Alerts Banner */}
      {medicalAlerts.length > 0 && (
        <div className="rounded-2xl border-2 border-red-500/50 bg-red-50/95 p-3 space-y-2 shadow-sm animate-pulse-subtle">
          <div className="flex items-center gap-2 text-red-700 font-bold text-xs">
            <AlertTriangle size={17} className="text-red-600 shrink-0" />
            <span>هشدار بالینی مهم دندانپزشکی ({medicalAlerts.length} مورد ریسک / تداخل)</span>
          </div>
          <div className="space-y-1.5">
            {medicalAlerts.map((alert, idx) => (
              <div key={`${alert.keyword}_${idx}`} className="text-[11px] bg-white/90 rounded-xl p-2 border border-red-200">
                <span className="font-bold text-red-700">{alert.titleFa}: </span>
                <span className="text-red-950 leading-relaxed font-medium">{alert.recommendationFa}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Clinical Actions */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={onOpenGallery}
          className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-cyan-600 hover:bg-cyan-700 text-white text-[11px] font-bold shadow-md shadow-cyan-600/20 transition-all active:scale-95"
        >
          <Camera size={14} />
          گالری و OPG
        </button>
        <button
          onClick={onOpenPrint}
          className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold shadow-md shadow-blue-600/20 transition-all active:scale-95"
        >
          <Printer size={14} />
          فاکتور بیمه
        </button>
        <button
          onClick={onOpenConsent}
          className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-md shadow-emerald-600/20 transition-all active:scale-95"
        >
          <FileSignature size={14} />
          رضایت‌نامه A4
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card p-3 text-center"><p className="text-[10px] text-gray-400">هزینه کل</p><p className="text-sm font-bold text-gray-700">{totalCost.toLocaleString('fa-IR')}</p></div>
        <div className="glass-card p-3 text-center"><p className="text-[10px] text-gray-400">پرداخت‌شده</p><p className="text-sm font-bold text-green-600">{totalPaid.toLocaleString('fa-IR')}</p></div>
        <div className="glass-card p-3 text-center"><p className="text-[10px] text-gray-400">باقی‌مانده</p><p className={`text-sm font-bold ${balance > 0 ? 'text-red-500' : 'text-green-500'}`}>{balance.toLocaleString('fa-IR')}</p></div>
      </div>

      {(installmentDebt > 0 || pendingChecks > 0) && (
        <div className="flex gap-2">
          {installmentDebt > 0 && (
            <div className="flex-1 glass-card p-2.5 flex items-center gap-2" style={{ borderRight: '3px solid #3B82F6' }}>
              <CreditCard size={16} className="text-blue-500" />
              <div><p className="text-[10px] text-gray-400">باقی اقساط</p><p className="text-xs font-bold text-blue-600">{installmentDebt.toLocaleString('fa-IR')} ت</p></div>
            </div>
          )}
          {pendingChecks > 0 && (
            <div className="flex-1 glass-card p-2.5 flex items-center gap-2" style={{ borderRight: '3px solid #F59E0B' }}>
              <ScrollText size={16} className="text-amber-500" />
              <div><p className="text-[10px] text-gray-400">چک در جریان</p><p className="text-xs font-bold text-amber-600">{pendingChecks.toLocaleString('fa-IR')} ت</p></div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-xl bg-gray-100/80 overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${tab === t.id ? 'bg-white shadow-sm' : 'text-gray-400'}`} style={tab === t.id ? { color: t.color } : undefined}>
              <Icon size={13} />{t.label}
              {t.count !== undefined && t.count > 0 && <span className="text-[9px] px-1 rounded-full" style={{ background: `${t.color}20`, color: t.color }}>{t.count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'info' && <InfoTab patient={patient} />}
      {tab === 'chart' && <PalmerChart patientId={patient.id} />}
      {tab === 'treatments' && <TreatmentsTab patientId={patient.id} treatments={treatments} />}
      {tab === 'payments' && <PaymentsTab patientId={patient.id} payments={payments} treatments={treatments} />}
      {tab === 'installments' && <InstallmentsTab patientId={patient.id} installments={installments} />}
      {tab === 'checks' && <ChecksTab patientId={patient.id} checks={checks} installments={installments} />}
      {tab === 'safteh' && <SaftehTab patientId={patient.id} safteh={safteh} />}
      {tab === 'lab' && <LabTab patientId={patient.id} labOrders={labOrders} />}
      {tab === 'implants' && <ImplantsTab patientId={patient.id} implants={implants} />}
      {tab === 'reminders' && <RemindersTab patientId={patient.id} reminders={reminders} />}

      <div className="flex gap-2 pt-2">
        <Button variant="secondary" color="#10B981" onClick={onEdit} className="flex-1">ویرایش پرونده</Button>
        <Button variant="danger" onClick={onDelete} className="flex-1">حذف پرونده</Button>
      </div>
    </div>
  );
}

// ==================== INFO TAB ====================
function InfoTab({ patient }: { patient: Patient }) {
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="grid grid-cols-2 gap-3">
        {patient.phone && <InfoItem icon={<Phone size={14} />} label="تلفن" value={patient.phone} />}
        {patient.national_id && <InfoItem icon={<FileText size={14} />} label="کد ملی" value={patient.national_id} />}
        {patient.birth_date && <InfoItem icon={<Calendar size={14} />} label="تولد" value={patient.birth_date} />}
        {patient.blood_type && <InfoItem icon={<Heart size={14} />} label="گروه خونی" value={patient.blood_type} />}
        {patient.insurance_provider && <InfoItem icon={<Shield size={14} />} label="بیمه" value={patient.insurance_provider} />}
      </div>
      {patient.allergies && <DetailBlock icon={<AlertCircle size={14} />} color="#EF4444" label="حساسیت‌ها" value={patient.allergies} />}
      {patient.medical_history && <DetailBlock icon={<Heart size={14} />} color="#8B5CF6" label="سابقه پزشکی" value={patient.medical_history} />}
      {patient.medications && <DetailBlock icon={<Pill size={14} />} color="#3B82F6" label="داروها" value={patient.medications} />}
      {patient.address && <DetailBlock icon={<FileText size={14} />} color="#6B7280" label="آدرس" value={patient.address} />}
      {patient.notes && <DetailBlock icon={<FileText size={14} />} color="#6B7280" label="یادداشت" value={patient.notes} />}
    </div>
  );
}

// ==================== TREATMENTS TAB ====================
function TreatmentsTab({ patientId, treatments }: { patientId: string; treatments: Treatment[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ diagnosis: '', treatment_plan: '', tooth_numbers: '', total_cost: '', status: 'planned' });

  const save = async () => {
    if (!form.diagnosis.trim()) return;
    setSaving(true);
    await supabase.from('treatments').insert({
      patient_id: patientId, diagnosis: form.diagnosis,
      treatment_plan: form.treatment_plan || null, tooth_numbers: form.tooth_numbers || null,
      total_cost: Number(form.total_cost) || 0, paid_amount: 0, status: form.status,
    });
    setSaving(false); setShowForm(false);
    setForm({ diagnosis: '', treatment_plan: '', tooth_numbers: '', total_cost: '', status: 'planned' });
  };
  const del = async (id: string) => { await supabase.from('treatments').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="درمان‌ها" count={treatments.length} onAdd={() => setShowForm(true)} color="#8B5CF6" icon={<Stethoscope size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت سریع درمان برای بیمار" icon={<Stethoscope size={20} />} color="#8B5CF6">
        <div className="space-y-4">
          <Field label="تشخیص"><Input value={form.diagnosis} onChange={e => setForm({ ...form, diagnosis: e.target.value })} placeholder="تشخیص بیماری..." /></Field>
          <Field label="طرح درمان"><Textarea rows={2} value={form.treatment_plan} onChange={e => setForm({ ...form, treatment_plan: e.target.value })} placeholder="شرح درمان..." /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="دندان‌ها"><Input value={form.tooth_numbers} onChange={e => setForm({ ...form, tooth_numbers: e.target.value })} placeholder="مثلاً ۱۶، ۱۷" /></Field>
            <Field label="هزینه (تومان)"><Input type="number" value={form.total_cost} onChange={e => setForm({ ...form, total_cost: e.target.value })} placeholder="0" /></Field>
          </div>
          <Field label="وضعیت"><Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} options={TREATMENT_STATUS} /></Field>
          <Button color="#8B5CF6" disabled={saving || !form.diagnosis.trim()} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت درمان'}</Button>
        </div>
      </Sheet>
      {treatments.length === 0 ? <EmptyHint text="درمانی ثبت نشده — روی + درمان جدید را ثبت کنید" /> : treatments.map(t => (
        <div key={t.id} className="glass-card p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-bold text-gray-700">{t.diagnosis ?? 'بدون تشخیص'}</p>
            <div className="flex items-center gap-2">
              <Badge color="#8B5CF6" bg="#EDE9FE">{TREATMENT_STATUS.find(s => s.value === t.status)?.label ?? t.status}</Badge>
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
    </div>
  );
}

// ==================== PAYMENTS TAB ====================
function PaymentsTab({ patientId, payments, treatments }: { patientId: string; payments: Payment[]; treatments: Treatment[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [desc, setDesc] = useState('');
  const [treatmentId, setTreatmentId] = useState('');

  const save = async () => {
    if (!amount || Number(amount) <= 0) return;
    setSaving(true);
    const paymentData: Record<string, unknown> = {
      patient_id: patientId, amount: Number(amount),
      payment_method: method, payment_date: todayGregorian(),
      description: desc || null, status: 'completed',
    };
    if (treatmentId) paymentData.treatment_id = treatmentId;
    await supabase.from('payments').insert(paymentData);
    // Also create a finance transaction
    await supabase.from('finance_transactions').insert({
      type: 'income', category: 'patient_payment', amount: Number(amount),
      transaction_date: todayGregorian(),
      description: desc || 'پرداخت بیمار', patient_id: patientId,
      payment_method: method,
    });
    setSaving(false); setShowForm(false); setAmount(''); setDesc(''); setTreatmentId('');
  };
  const del = async (id: string) => { await supabase.from('payments').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="پرداخت‌ها" count={payments.length} onAdd={() => setShowForm(true)} color="#22C55E" icon={<Wallet size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت دریافت پرداخت از بیمار" icon={<Wallet size={20} />} color="#22C55E">
        <div className="space-y-4">
          <Field label="مبلغ (تومان)"><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="مبلغ پرداخت" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="روش پرداخت"><Select value={method} onChange={e => setMethod(e.target.value)} options={PAYMENT_METHODS} /></Field>
            <Field label="درمان مرتبط">
              <Select value={treatmentId} onChange={e => setTreatmentId(e.target.value)} options={[{ value: '', label: 'بدون درمان' }, ...treatments.map(t => ({ value: t.id, label: t.diagnosis ?? 'درمان' }))]} />
            </Field>
          </div>
          <Field label="شرح"><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="شرح پرداخت..." /></Field>
          <Button color="#22C55E" disabled={saving || !amount} className="w-full" onClick={save}>{saving ? 'در حال ثبت...' : 'ثبت پرداخت'}</Button>
        </div>
      </Sheet>
      {payments.length === 0 ? <EmptyHint text="پرداختی ثبت نشده — روی + پرداخت جدید ثبت کنید" /> : payments.map(p => (
        <div key={p.id} className="glass-card p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center"><ArrowUpCircle size={18} className="text-green-600" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-700">{Number(p.amount).toLocaleString('fa-IR')} ت</p>
              <p className="text-[10px] text-gray-400">{toJalaliStr(p.payment_date)} • {PAYMENT_METHODS.find(m => m.value === p.payment_method)?.label ?? p.payment_method}</p>
            </div>
            <Badge color="#22C55E" bg="#DCFCE7">{p.status}</Badge>
            <DeleteBtn onClick={() => del(p.id)} />
          </div>
          {p.description && <p className="text-xs text-gray-500 mt-1">{p.description}</p>}
        </div>
      ))}
    </div>
  );
}

// ==================== INSTALLMENTS TAB ====================
function InstallmentsTab({ patientId, installments }: { patientId: string; installments: Installment[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ total_amount: '', monthly_amount: '', total_months: '1', start_date: todayGregorian(), notes: '' });

  const save = async () => {
    if (!form.total_amount) return;
    setSaving(true);
    const total = Number(form.total_amount);
    const monthly = Number(form.monthly_amount) || Math.ceil(total / Number(form.total_months));
    const startDate = new Date(form.start_date);
    const nextDue = new Date(startDate); nextDue.setMonth(nextDue.getMonth() + 1);
    await supabase.from('installments').insert({
      patient_id: patientId, total_amount: total, paid_amount: 0,
      monthly_amount: monthly, total_months: Number(form.total_months), paid_months: 0,
      start_date: form.start_date, next_due_date: nextDue.toISOString().slice(0, 10),
      status: 'active', notes: form.notes || null,
    });
    setSaving(false); setShowForm(false);
    setForm({ total_amount: '', monthly_amount: '', total_months: '1', start_date: todayGregorian(), notes: '' });
  };

  const payInstallment = async (inst: Installment) => {
    const newPaid = Number(inst.paid_amount) + Number(inst.monthly_amount);
    const newMonths = inst.paid_months + 1;
    const nextDue = new Date(inst.next_due_date ?? new Date()); nextDue.setMonth(nextDue.getMonth() + 1);
    const status = newMonths >= inst.total_months ? 'completed' : 'active';
    await supabase.from('installments').update({
      paid_amount: newPaid, paid_months: newMonths,
      next_due_date: status === 'completed' ? null : nextDue.toISOString().slice(0, 10), status,
    }).eq('id', inst.id);
    // Also record payment
    await supabase.from('payments').insert({
      patient_id: patientId, amount: Number(inst.monthly_amount),
      payment_method: 'installment', payment_date: todayGregorian(),
      description: `قسط ${newMonths}/${inst.total_months}`, status: 'completed',
    });
    await supabase.from('finance_transactions').insert({
      type: 'income', category: 'patient_payment', amount: Number(inst.monthly_amount),
      transaction_date: todayGregorian(),
      description: `قسط ${newMonths}/${inst.total_months}`, patient_id: patientId, payment_method: 'installment',
    });
  };

  const del = async (id: string) => { await supabase.from('installments').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="اقساط" count={installments.length} onAdd={() => setShowForm(true)} color="#3B82F6" icon={<CreditCard size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="تعریف پلن اقساطی جدید" icon={<CreditCard size={20} />} color="#3B82F6">
        <div className="space-y-4">
          <Field label="مبلغ کل (تومان)"><Input type="number" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })} placeholder="مبلغ کل" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="مبلغ هر قسط"><Input type="number" value={form.monthly_amount} onChange={e => setForm({ ...form, monthly_amount: e.target.value })} placeholder="خودی محاسبه می‌شود" /></Field>
            <Field label="تعداد اقساط"><Input type="number" value={form.total_months} onChange={e => setForm({ ...form, total_months: e.target.value })} /></Field>
          </div>
          <Field label="تاریخ شروع"><JalaliDatePicker value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} /></Field>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          <Button color="#3B82F6" disabled={saving || !form.total_amount} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت پلن اقساطی'}</Button>
        </div>
      </Sheet>
      {installments.length === 0 ? <EmptyHint text="پلن اقساطی ثبت نشده — روی + پلن جدید بسازید" /> : installments.map(inst => {
        const status = INSTALLMENT_STATUS[inst.status] ?? INSTALLMENT_STATUS.active;
        const remaining = Number(inst.total_amount) - Number(inst.paid_amount);
        const progress = Number(inst.total_amount) > 0 ? (Number(inst.paid_amount) / Number(inst.total_amount)) * 100 : 0;
        return (
          <div key={inst.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-700">پلن اقساطی {inst.total_months} ماهه</p>
              <div className="flex items-center gap-2">
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(inst.id)} />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-gray-400">پرداخت‌شده: {Number(inst.paid_amount).toLocaleString('fa-IR')} ت</span>
              <span className="text-gray-400">باقی: {remaining.toLocaleString('fa-IR')} ت</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: '#3B82F6' }} />
            </div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-blue-500 font-semibold">{inst.paid_months}/{inst.total_months} قسط</span>
              <span className="text-gray-400">هر قسط: {Number(inst.monthly_amount).toLocaleString('fa-IR')} ت</span>
            </div>
            {inst.next_due_date && (
              <div className="flex items-center gap-1.5 text-xs text-amber-500 mb-2">
                <CalendarClock size={12} /> سررسید بعدی: {toJalaliStr(inst.next_due_date ?? '')}
              </div>
            )}
            {inst.status === 'active' && (
              <Button color="#3B82F6" className="w-full" onClick={() => payInstallment(inst)}>ثبت پرداخت قسط ({Number(inst.monthly_amount).toLocaleString('fa-IR')} ت)</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== CHECKS TAB ====================
function ChecksTab({ patientId, checks, installments }: { patientId: string; checks: CheckType[]; installments: Installment[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ check_number: '', bank_name: '', amount: '', issue_date: todayGregorian(), due_date: '', installment_id: '', notes: '' });

  const save = async () => {
    if (!form.amount || !form.due_date) return;
    setSaving(true);
    await supabase.from('checks').insert({
      patient_id: patientId, check_number: form.check_number || null,
      bank_name: form.bank_name || null, amount: Number(form.amount),
      issue_date: form.issue_date, due_date: form.due_date,
      installment_id: form.installment_id || null, notes: form.notes || null,
      status: 'pending',
    });
    setSaving(false); setShowForm(false);
    setForm({ check_number: '', bank_name: '', amount: '', issue_date: todayGregorian(), due_date: '', installment_id: '', notes: '' });
  };

  const updateStatus = async (id: string, status: string) => { await supabase.from('checks').update({ status }).eq('id', id); };
  const del = async (id: string) => { await supabase.from('checks').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="چک‌ها" count={checks.length} onAdd={() => setShowForm(true)} color="#F59E0B" icon={<ScrollText size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت چک جدید بیمار" icon={<ScrollText size={20} />} color="#F59E0B">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="شماره چک"><Input value={form.check_number} onChange={e => setForm({ ...form, check_number: e.target.value })} placeholder="شماره چک" /></Field>
            <Field label="نام بانک"><Input value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="نام بانک" /></Field>
          </div>
          <Field label="مبلغ (تومان)"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="مبلغ چک" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاریخ صدور"><JalaliDatePicker value={form.issue_date} onChange={v => setForm({ ...form, issue_date: v })} /></Field>
            <Field label="تاریخ سررسید"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
          </div>
          {installments.length > 0 && (
            <Field label="پلن اقساطی مرتبط">
              <Select value={form.installment_id} onChange={e => setForm({ ...form, installment_id: e.target.value })} options={[{ value: '', label: 'بدون پلن' }, ...installments.map(i => ({ value: i.id, label: `اقساط ${i.total_months} ماهه` }))]} />
            </Field>
          )}
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          <Button color="#F59E0B" disabled={saving || !form.amount || !form.due_date} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت چک'}</Button>
        </div>
      </Sheet>
      {checks.length === 0 ? <EmptyHint text="چکی ثبت نشده — روی + چک جدید ثبت کنید" /> : checks.map(c => {
        const status = CHECK_STATUS[c.status] ?? CHECK_STATUS.pending;
        return (
          <div key={c.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">چک {c.check_number ?? ''}</p>
              <div className="flex items-center gap-2">
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(c.id)} />
              </div>
            </div>
            <p className="text-sm font-bold text-amber-600">{Number(c.amount).toLocaleString('fa-IR')} ت</p>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
              {c.bank_name && <span>بانک: {c.bank_name}</span>}
              <span className="flex items-center gap-1"><CalendarClock size={11} /> سررسید: {toJalaliStr(c.due_date)}</span>
            </div>
            {c.notes && <p className="text-xs text-gray-500 mt-1">{c.notes}</p>}
            {c.status === 'pending' && (
              <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <button onClick={() => updateStatus(c.id, 'cleared')} className="flex-1 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic">وصول شد</button>
                <button onClick={() => updateStatus(c.id, 'bounced')} className="flex-1 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-semibold haptic">برگشت خورد</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== SAFTEH TAB ====================
function SaftehTab({ patientId, safteh }: { patientId: string; safteh: Safteh[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ safteh_number: '', amount: '', issue_date: todayGregorian(), due_date: '', guarantor_name: '', guarantor_national_id: '', notes: '' });

  const save = async () => {
    if (!form.amount || !form.due_date) return;
    setSaving(true);
    await supabase.from('safteh').insert({
      patient_id: patientId, safteh_number: form.safteh_number || null,
      amount: Number(form.amount), issue_date: form.issue_date, due_date: form.due_date,
      guarantor_name: form.guarantor_name || null,
      guarantor_national_id: form.guarantor_national_id || null,
      status: 'pending', notes: form.notes || null,
    });
    setSaving(false); setShowForm(false);
    setForm({ safteh_number: '', amount: '', issue_date: todayGregorian(), due_date: '', guarantor_name: '', guarantor_national_id: '', notes: '' });
  };
  const updateStatus = async (id: string, status: string) => { await supabase.from('safteh').update({ status }).eq('id', id); };
  const del = async (id: string) => { await supabase.from('safteh').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="سفته‌ها" count={safteh.length} onAdd={() => setShowForm(true)} color="#6366F1" icon={<ScrollText size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت سفته ضمانت جدید" icon={<ScrollText size={20} />} color="#6366F1">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="شماره سفته"><Input value={form.safteh_number} onChange={e => setForm({ ...form, safteh_number: e.target.value })} placeholder="شماره سفته" /></Field>
            <Field label="مبلغ (تومان)"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="مبلغ" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاریخ صدور"><JalaliDatePicker value={form.issue_date} onChange={v => setForm({ ...form, issue_date: v })} /></Field>
            <Field label="تاریخ سررسید"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نام ضامن"><Input value={form.guarantor_name} onChange={e => setForm({ ...form, guarantor_name: e.target.value })} placeholder="نام ضامن" /></Field>
            <Field label="کد ملی ضامن"><Input value={form.guarantor_national_id} onChange={e => setForm({ ...form, guarantor_national_id: e.target.value })} placeholder="کد ملی ضامن" /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          <Button color="#6366F1" disabled={saving || !form.amount || !form.due_date} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت سفته'}</Button>
        </div>
      </Sheet>
      {safteh.length === 0 ? <EmptyHint text="سفته‌ای ثبت نشده — روی + سفته جدید ثبت کنید" /> : safteh.map(sf => {
        const status = CHECK_STATUS[sf.status] ?? CHECK_STATUS.pending;
        return (
          <div key={sf.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">سفته {sf.safteh_number ?? ''}</p>
              <div className="flex items-center gap-2">
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(sf.id)} />
              </div>
            </div>
            <p className="text-sm font-bold text-indigo-600">{Number(sf.amount).toLocaleString('fa-IR')} ت</p>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
              <span className="flex items-center gap-1"><CalendarClock size={11} /> سررسید: {toJalaliStr(sf.due_date)}</span>
            </div>
            {sf.guarantor_name && <p className="text-xs text-gray-500 mt-1">ضامن: {sf.guarantor_name}{sf.guarantor_national_id ? ` (${sf.guarantor_national_id})` : ''}</p>}
            {sf.notes && <p className="text-xs text-gray-500 mt-1">{sf.notes}</p>}
            {sf.status === 'pending' && (
              <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <button onClick={() => updateStatus(sf.id, 'cleared')} className="flex-1 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic">تسویه شد</button>
                <button onClick={() => updateStatus(sf.id, 'bounced')} className="flex-1 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-semibold haptic">برگشت خورد</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== LAB TAB ====================
function LabTab({ patientId, labOrders }: { patientId: string; labOrders: LabOrder[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ lab_name: '', work_type: 'crown', tooth_numbers: '', shade: '', material: '', due_date: '', cost: '', notes: '' });

  const save = async () => {
    setSaving(true);
    await supabase.from('lab_orders').insert({
      patient_id: patientId, lab_name: form.lab_name || null,
      work_type: form.work_type, tooth_numbers: form.tooth_numbers || null,
      shade: form.shade || null, material: form.material || null,
      status: 'sent', sent_date: todayGregorian(),
      due_date: form.due_date || null, cost: Number(form.cost) || 0,
      notes: form.notes || null,
    });
    setSaving(false); setShowForm(false);
    setForm({ lab_name: '', work_type: 'crown', tooth_numbers: '', shade: '', material: '', due_date: '', cost: '', notes: '' });
  };

  const updateStatus = async (id: string, status: string) => {
    const update: Record<string, unknown> = { status };
    if (status === 'received') update.received_date = todayGregorian();
    await supabase.from('lab_orders').update(update).eq('id', id);
  };
  const del = async (id: string) => { await supabase.from('lab_orders').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="کار لابراتوار" count={labOrders.length} onAdd={() => setShowForm(true)} color="#EC4899" icon={<FlaskConical size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ارسال سفارش جدید به لابراتوار" icon={<FlaskConical size={20} />} color="#EC4899">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="نام لابراتوار"><Input value={form.lab_name} onChange={e => setForm({ ...form, lab_name: e.target.value })} placeholder="نام لابراتوار" /></Field>
            <Field label="نوع کار"><Select value={form.work_type} onChange={e => setForm({ ...form, work_type: e.target.value })} options={LAB_WORK_TYPES} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="دندان‌ها"><Input value={form.tooth_numbers} onChange={e => setForm({ ...form, tooth_numbers: e.target.value })} placeholder="شماره دندان‌ها" /></Field>
            <Field label="رنگ"><Input value={form.shade} onChange={e => setForm({ ...form, shade: e.target.value })} placeholder="مثلاً A2" /></Field>
          </div>
          <Field label="متریال"><Input value={form.material} onChange={e => setForm({ ...form, material: e.target.value })} placeholder="مثلاً زیرکونیا" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="موعد تحویل"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
            <Field label="هزینه"><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="هزینه" /></Field>
          </div>
          <Button color="#EC4899" disabled={saving} className="w-full" onClick={save}>{saving ? 'در حال ارسال...' : 'ارسال به لابراتوار'}</Button>
        </div>
      </Sheet>
      {labOrders.length === 0 ? <EmptyHint text="کاری برای لابراتوار ارسال نشده" /> : labOrders.map(l => {
        const status = LAB_STATUS[l.status] ?? LAB_STATUS.sent;
        const workType = LAB_WORK_TYPES.find(w => w.value === l.work_type)?.label ?? l.work_type;
        return (
          <div key={l.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">{workType} — {l.lab_name ?? 'لابراتوار'}</p>
              <div className="flex items-center gap-2">
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(l.id)} />
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {l.tooth_numbers && <span>دندان: {l.tooth_numbers}</span>}
              {l.shade && <span>رنگ: {l.shade}</span>}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">ارسال: {toJalaliStr(l.sent_date)}</span>
              {l.due_date && <span className="text-xs text-amber-500">موعد: {toJalaliStr(l.due_date)}</span>}
              {Number(l.cost) > 0 && <span className="text-xs font-bold text-pink-600">{Number(l.cost).toLocaleString('fa-IR')} ت</span>}
            </div>
            {(l.status === 'sent' || l.status === 'in_progress') && (
              <div className="flex gap-1.5 mt-2">
                {l.status === 'sent' && <button onClick={() => updateStatus(l.id, 'in_progress')} className="flex-1 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-xs font-semibold haptic">در حال ساخت</button>}
                <button onClick={() => updateStatus(l.id, 'received')} className="flex-1 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic">دریافت شد</button>
              </div>
            )}
            {l.status === 'received' && (
              <button onClick={() => updateStatus(l.id, 'delivered_to_patient')} className="w-full mt-2 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-xs font-semibold haptic">تحویل به بیمار</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== IMPLANTS TAB ====================
function ImplantsTab({ patientId, implants }: { patientId: string; implants: Implant[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ tooth_number: '', brand: '', implant_size: '', cost: '', notes: '' });

  const save = async () => {
    setSaving(true);
    await supabase.from('implants').insert({
      patient_id: patientId, tooth_number: form.tooth_number ? Number(form.tooth_number) : null,
      brand: form.brand || null, implant_size: form.implant_size || null,
      stage: 'planning', cost: Number(form.cost) || 0, paid_amount: 0,
      notes: form.notes || null,
    });
    setSaving(false); setShowForm(false);
    setForm({ tooth_number: '', brand: '', implant_size: '', cost: '', notes: '' });
  };

  const updateStage = async (id: string, stage: string) => {
    const update: Record<string, unknown> = { stage };
    const today = todayGregorian();
    if (stage === 'implant_placement') update.placement_date = today;
    if (stage === 'osseointegration') update.osseointegration_date = today;
    if (stage === 'abutment_placement') update.abutment_date = today;
    if (stage === 'crown_fitting') update.crown_date = today;
    await supabase.from('implants').update(update).eq('id', id);
  };
  const del = async (id: string) => { await supabase.from('implants').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="ایمپلنت‌ها" count={implants.length} onAdd={() => setShowForm(true)} color="#06B6D4" icon={<Anchor size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت ایمپلنت جدید بیمار" icon={<Anchor size={20} />} color="#06B6D4">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="شماره دندان"><Input type="number" value={form.tooth_number} onChange={e => setForm({ ...form, tooth_number: e.target.value })} placeholder="مثلاً ۱۶" /></Field>
            <Field label="برند"><Input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="مثلاً Straumann" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سایز"><Input value={form.implant_size} onChange={e => setForm({ ...form, implant_size: e.target.value })} placeholder="مثلاً 4.3×10mm" /></Field>
            <Field label="هزینه"><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="هزینه" /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          <Button color="#06B6D4" disabled={saving} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت ایمپلنت'}</Button>
        </div>
      </Sheet>
      {implants.length === 0 ? <EmptyHint text="ایمپلنتی ثبت نشده" /> : implants.map(im => {
        const stageInfo = IMPLANT_STAGES.find(s => s.value === im.stage) ?? IMPLANT_STAGES[0];
        const stageIdx = IMPLANT_STAGES.findIndex(s => s.value === im.stage);
        const balance = Number(im.cost) - Number(im.paid_amount);
        return (
          <div key={im.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-700">ایمپلنت دندان {im.tooth_number ?? '-'}</p>
              <div className="flex items-center gap-2">
                <Badge color="#06B6D4" bg="#CFFAFE">{stageInfo.label}</Badge>
                <DeleteBtn onClick={() => del(im.id)} />
              </div>
            </div>
            {im.brand && <p className="text-xs text-gray-400">{im.brand} • {im.implant_size}</p>}
            {/* Progress bar */}
            <div className="flex items-center gap-1 my-2">
              {IMPLANT_STAGES.slice(0, 7).map((s, idx) => (
                <div key={s.value} className="flex items-center flex-1">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: idx <= stageIdx ? '#06B6D4' : '#E5E7EB' }} />
                  {idx < 6 && <div className="flex-1 h-0.5 rounded-full" style={{ background: idx < stageIdx ? '#06B6D4' : '#E5E7EB' }} />}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100">
              <span className="font-bold text-cyan-600">{Number(im.cost).toLocaleString('fa-IR')} ت</span>
              {balance > 0 ? <span className="text-red-500">باقی: {balance.toLocaleString('fa-IR')} ت</span> : <span className="text-green-500">تسویه</span>}
            </div>
            {im.stage !== 'completed' && im.stage !== 'failed' && (
              <Select className="mt-2 text-xs" value={im.stage} onChange={e => updateStage(im.id, e.target.value)} options={IMPLANT_STAGES} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== REMINDERS TAB ====================
function RemindersTab({ patientId, reminders }: { patientId: string; reminders: Reminder[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', reminder_date: todayGregorian(), reminder_time: '09:00', category: 'follow_up', priority: 'medium' });

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    await supabase.from('reminders').insert({
      patient_id: patientId, title: form.title, description: form.description || null,
      reminder_date: form.reminder_date, reminder_time: form.reminder_time,
      category: form.category, priority: form.priority, status: 'pending',
    });
    setSaving(false); setShowForm(false);
    setForm({ title: '', description: '', reminder_date: todayGregorian(), reminder_time: '09:00', category: 'follow_up', priority: 'medium' });
  };

  const updateStatus = async (id: string, status: string) => { await supabase.from('reminders').update({ status }).eq('id', id); };
  const del = async (id: string) => { await supabase.from('reminders').delete().eq('id', id); };

  const PRIORITY_COLORS: Record<string, { color: string; bg: string }> = {
    low: { color: '#9CA3AF', bg: '#F3F4F6' },
    medium: { color: '#F59E0B', bg: '#FEF3C7' },
    high: { color: '#F97316', bg: '#FFEDD5' },
    urgent: { color: '#EF4444', bg: '#FEE2E2' },
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="یادآوری‌ها" count={reminders.length} onAdd={() => setShowForm(true)} color="#EF4444" icon={<BellRing size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت یادآوری جدید برای بیمار" icon={<BellRing size={20} />} color="#EF4444">
        <div className="space-y-4">
          <Field label="عنوان"><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="عنوان یادآوری" /></Field>
          <Field label="شرح"><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="شرح..." /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاریخ"><JalaliDatePicker value={form.reminder_date} onChange={v => setForm({ ...form, reminder_date: v })} /></Field>
            <Field label="ساعت"><Input type="time" value={form.reminder_time} onChange={e => setForm({ ...form, reminder_time: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="بخش"><Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={REMINDER_CATEGORIES} /></Field>
            <Field label="اولویت"><Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} options={REMINDER_PRIORITIES} /></Field>
          </div>
          <Button color="#EF4444" disabled={saving || !form.title.trim()} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت یادآوری'}</Button>
        </div>
      </Sheet>
      {reminders.length === 0 ? <EmptyHint text="یادآوری‌ای ثبت نشده" /> : reminders.map(r => {
        const priority = PRIORITY_COLORS[r.priority] ?? PRIORITY_COLORS.medium;
        return (
          <div key={r.id} className="glass-card p-3" style={{ borderRight: r.status === 'pending' ? '3px solid #EF4444' : undefined }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">{r.title}</p>
              <div className="flex items-center gap-2">
                <Badge color={priority.color} bg={priority.bg}>{r.priority}</Badge>
                <DeleteBtn onClick={() => del(r.id)} />
              </div>
            </div>
            {r.description && <p className="text-xs text-gray-500">{r.description}</p>}
            <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
              <span className="flex items-center gap-1"><Calendar size={11} />{toJalaliStr(r.reminder_date)}</span>
              <span className="flex items-center gap-1"><Clock size={11} />{r.reminder_time.slice(0, 5)}</span>
            </div>
            {r.status === 'pending' && (
              <button onClick={() => updateStatus(r.id, 'done')} className="w-full mt-2 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic flex items-center justify-center gap-1">
                <CheckCircle2 size={14} /> انجام شد
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}