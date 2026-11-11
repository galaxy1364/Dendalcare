import { useState, useMemo, useEffect } from 'react';
import {
  BellRing, Plus, Search, Clock, Calendar, CheckCircle2,
  Bell, Sparkles, Phone, X, CreditCard,
  FileCheck, FlaskConical, Anchor, CalendarClock, SlidersHorizontal,
  Package, MessageSquare, Copy, Check, Send, ShieldAlert, Zap,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase,
  type Reminder, type Patient, type Check as CheckType, type Installment,
  type LabOrder, type Implant, type Appointment, type Treatment,
  type InventoryItem, type Safteh,
} from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState, Loading } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import {
  loadSmartReminderRules,
  saveSmartReminderRules,
  computeLiveSmartAlerts,
  syncLiveAlertsToDatabaseReminders,
  addDaysIso,
  type SmartReminderRules,
  type LiveSmartAlert,
} from '@/lib/smartReminderEngine';

const CATEGORIES = [
  { value: 'appointment', label: 'نوبت و ویزیت' },
  { value: 'payment', label: 'چک، اقساط و بدهی' },
  { value: 'lab', label: 'لابراتوار رفت و برگشت' },
  { value: 'implant', label: 'مراحل ایمپلنت' },
  { value: 'inventory', label: 'کمبود و انقضای انبار' },
  { value: 'treatment', label: 'پیگیری درمان' },
  { value: 'follow_up', label: 'فالوآپ بیمار' },
  { value: 'other', label: 'سایر' },
];

const PRIORITIES = [
  { value: 'low', label: 'کم', color: '#9CA3AF', bg: '#F3F4F6' },
  { value: 'medium', label: 'متوسط', color: '#F59E0B', bg: '#FEF3C7' },
  { value: 'high', label: 'زیاد', color: '#F97316', bg: '#FFEDD5' },
  { value: 'urgent', label: 'فوری', color: '#EF4444', bg: '#FEE2E2' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'در انتظار پیگیری', color: '#F59E0B', bg: '#FEF3C7' },
  sent: { label: 'اطلاع‌رسانی شده', color: '#3B82F6', bg: '#DBEAFE' },
  done: { label: 'انجام‌شده', color: '#22C55E', bg: '#DCFCE7' },
  snoozed: { label: 'به تعویق افتاده', color: '#9CA3AF', bg: '#F3F4F6' },
};

const CATEGORY_COLORS: Record<string, string> = {
  appointment: '#F59E0B',
  treatment: '#8B5CF6',
  lab: '#EC4899',
  implant: '#06B6D4',
  payment: '#22C55E',
  inventory: '#F97316',
  follow_up: '#3B82F6',
  other: '#6B7280',
};

const IMPLANT_PIPELINE = [
  { value: 'planning', label: 'برنامه‌ریزی' },
  { value: 'extraction_and_graft', label: 'کشیدن/پیوند' },
  { value: 'implant_placement', label: 'جراحی فیکسچر' },
  { value: 'osseointegration', label: 'هیلینگ' },
  { value: 'abutment_placement', label: 'قالب‌گیری' },
  { value: 'crown_fitting', label: 'نصب روکش' },
  { value: 'completed', label: 'تکمیل' },
];

const LAB_PIPELINE = [
  { value: 'sent', label: 'ارسال به لابراتوار' },
  { value: 'in_progress', label: 'در حال ساخت' },
  { value: 'received', label: 'دریافت در مطب' },
  { value: 'delivered_to_patient', label: 'تحویل به بیمار' },
];

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

type ReminderTabMode =
  | 'live_radar'
  | 'finance'
  | 'implant_lab'
  | 'appointments'
  | 'inventory'
  | 'stored';

export function Reminders() {
  const { data: reminders, loading, refresh } = useRealtimeTable<Reminder>('reminders');
  const { data: patients } = useRealtimeTable<Patient>('patients');
  const { data: checks, refresh: rChecks } = useRealtimeTable<CheckType>('checks');
  const { data: safteh } = useRealtimeTable<Safteh>('safteh');
  const { data: installments, refresh: rInst } = useRealtimeTable<Installment>('installments');
  const { data: labOrders, refresh: rLab } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: implants, refresh: rImp } = useRealtimeTable<Implant>('implants');
  const { data: appointments } = useRealtimeTable<Appointment>('appointments');
  const { data: treatments } = useRealtimeTable<Treatment>('treatments');
  const { data: inventory } = useRealtimeTable<InventoryItem>('inventory');

  const [tabMode, setTabMode] = useState<ReminderTabMode>('live_radar');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [rules, setRules] = useState<SmartReminderRules>(() => loadSmartReminderRules());
  const [scanningAll, setScanningAll] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // Smart SMS / WhatsApp Modal State
  const [smsAlert, setSmsAlert] = useState<{
    patientName: string;
    phone: string | null;
    text: string;
  } | null>(null);
  const [copiedSms, setCopiedSms] = useState(false);

  const today = todayGregorian();

  const updateRules = (partial: Partial<SmartReminderRules>) => {
    const next = { ...rules, ...partial };
    setRules(next);
    saveSmartReminderRules(next);
  };

  // Compute live cross-module smart alerts in real time
  const liveAlerts = useMemo(() => {
    return computeLiveSmartAlerts({
      patients,
      appointments,
      treatments,
      labOrders,
      implants,
      inventory,
      installments,
      checks,
      safteh,
      rules,
    });
  }, [patients, appointments, treatments, labOrders, implants, inventory, installments, checks, safteh, rules]);

  const filteredLiveAlerts = useMemo(() => {
    let list = liveAlerts;
    if (tabMode === 'finance') {
      list = list.filter(a => a.domain === 'check' || a.domain === 'safteh' || a.domain === 'installment' || a.domain === 'debt');
    } else if (tabMode === 'implant_lab') {
      list = list.filter(a => a.domain === 'implant' || a.domain === 'lab');
    } else if (tabMode === 'appointments') {
      list = list.filter(a => a.domain === 'appointment' || a.domain === 'treatment');
    } else if (tabMode === 'inventory') {
      list = list.filter(a => a.domain === 'inventory');
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        a =>
          a.title.toLowerCase().includes(q) ||
          a.subtitle.toLowerCase().includes(q) ||
          a.patientName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [liveAlerts, tabMode, search]);

  const filteredStoredReminders = useMemo(() => {
    let list = reminders;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        const p = patients.find(pt => pt.id === r.patient_id);
        const pName = p ? `${p.first_name} ${p.last_name}`.toLowerCase() : '';
        return (
          r.title.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          pName.includes(q)
        );
      });
    }
    return list.sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1;
      if (a.status !== 'done' && b.status === 'done') return -1;
      return a.reminder_date.localeCompare(b.reminder_date);
    });
  }, [reminders, search, patients]);

  // Radar counters across all domains
  const radarCounts = useMemo(() => {
    const critical = liveAlerts.filter(a => a.urgency === 'critical').length;
    const todayDue = liveAlerts.filter(a => a.urgency === 'today').length;
    const finance = liveAlerts.filter(a => a.domain === 'check' || a.domain === 'safteh' || a.domain === 'installment' || a.domain === 'debt').length;
    const impLab = liveAlerts.filter(a => a.domain === 'implant' || a.domain === 'lab').length;
    const inv = liveAlerts.filter(a => a.domain === 'inventory').length;
    const appts = liveAlerts.filter(a => a.domain === 'appointment').length;
    return { critical, todayDue, finance, impLab, inv, appts, total: liveAlerts.length };
  }, [liveAlerts]);

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  // Sync Live Alerts into Supabase Reminders Table
  const handleSyncToDatabase = async () => {
    setScanningAll(true);
    setScanResult(null);
    try {
      const inserted = await syncLiveAlertsToDatabaseReminders(liveAlerts, reminders);
      refresh();
      setScanResult(
        inserted > 0
          ? `${inserted.toLocaleString('fa-IR')} هشدار هوشمند جدید از کلیه بخش‌های مطب در پایگاه داده یادآوری‌ها ثبت و همگام شد.`
          : 'تمامی هشدارهای زنده مطب از قبل در پایگاه داده یادآوری‌ها ثبت و همگام هستند.'
      );
    } catch {
      setScanResult('خطا در همگام‌سازی خودکار یادآوری‌ها.');
    } finally {
      setScanningAll(false);
    }
  };

  // Interactive Stage Updaters directly from Reminder Cards!
  const handleAdvanceImplantStage = async (implantId: string, nextStage: string) => {
    const update: Record<string, unknown> = { stage: nextStage };
    if (nextStage === 'implant_placement') update.placement_date = today;
    if (nextStage === 'osseointegration') update.osseointegration_date = today;
    if (nextStage === 'abutment_placement') update.abutment_date = today;
    if (nextStage === 'crown_fitting') update.crown_date = today;
    await supabase.from('implants').update(update).eq('id', implantId);
    rImp();
  };

  const handleAdvanceLabStage = async (labId: string, nextStatus: string) => {
    const update: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === 'received') update.received_date = today;
    await supabase.from('lab_orders').update(update).eq('id', labId);
    rLab();
  };

  const handleQuickClearCheck = async (checkId: string) => {
    await supabase.from('checks').update({ status: 'cleared' }).eq('id', checkId);
    rChecks();
  };

  const handleQuickPayInstallment = async (instId: string) => {
    const inst = installments.find(i => i.id === instId);
    if (!inst) return;
    const newPaid = Number(inst.paid_amount) + Number(inst.monthly_amount);
    const newMonths = inst.paid_months + 1;
    const nextDue = new Date(inst.next_due_date || today);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const isComplete = newPaid >= Number(inst.total_amount);
    await supabase.from('installments').update({
      paid_amount: newPaid,
      paid_months: newMonths,
      next_due_date: isComplete ? null : nextDue.toISOString().slice(0, 10),
      status: isComplete ? 'completed' : 'active',
    }).eq('id', inst.id);
    rInst();
  };

  const handleSave = async (data: Partial<Reminder>): Promise<boolean> => {
    setSaving(true);
    const result = editing
      ? await supabase.from('reminders').update(data).eq('id', editing.id)
      : await supabase.from('reminders').insert(data);
    setSaving(false);
    if (result.error) return false;
    setSheetOpen(false);
    setEditing(null);
    setActionError(null);
    refresh();
    return true;
  };

  const handleStatusChange = async (id: string, status: string) => {
    const { error } = await supabase.from('reminders').update({ status }).eq('id', id);
    if (error) {
      setActionError('تغییر وضعیت انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  const handleSnoozeDays = async (r: Reminder, days: number) => {
    const nextDate = addDaysIso(r.reminder_date < today ? today : r.reminder_date, days);
    await supabase
      .from('reminders')
      .update({ reminder_date: nextDate, status: 'pending' })
      .eq('id', r.id);
    refresh();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('reminders').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      setActionError('حذف انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  useEffect(() => {
    if (rules.autoPilotEnabled && liveAlerts.length > 0 && reminders.length === 0) {
      syncLiveAlertsToDatabaseReminders(liveAlerts, reminders).then(() => refresh());
    }
  }, [rules.autoPilotEnabled, liveAlerts.length]);

  if (loading) return <Loading color="#EF4444" />;

  const chips: { v: ReminderTabMode; l: string; count: number; icon: React.ReactNode }[] = [
    { v: 'live_radar', l: 'رادار هوشمند کل مطب', count: radarCounts.total, icon: <Zap size={13} /> },
    { v: 'finance', l: 'چک، اقساط و بدهی', count: radarCounts.finance, icon: <CreditCard size={13} /> },
    { v: 'implant_lab', l: 'ایمپلنت و لابراتوار', count: radarCounts.impLab, icon: <Anchor size={13} /> },
    { v: 'appointments', l: 'نوبت‌دهی و فالوآپ', count: radarCounts.appts, icon: <CalendarClock size={13} /> },
    { v: 'inventory', l: 'کمبود و انقضای انبار', count: radarCounts.inv, icon: <Package size={13} /> },
    { v: 'stored', l: 'یادآوری‌های دستی/ثبت‌شده', count: reminders.length, icon: <BellRing size={13} /> },
  ];

  const urgencyStyles: Record<LiveSmartAlert['urgency'], { label: string; color: string; bg: string; border: string }> = {
    critical: { label: 'بحرانی / سررسید گذشته', color: '#DC2626', bg: '#FEE2E2', border: '#EF4444' },
    today: { label: 'فوری / موعد امروز', color: '#D97706', bg: '#FEF3C7', border: '#F59E0B' },
    upcoming: { label: 'پیش‌هشدار هوشمند', color: '#2563EB', bg: '#DBEAFE', border: '#3B82F6' },
    normal: { label: 'عادی', color: '#64748B', bg: '#F1F5F9', border: '#94A3B8' },
  };

  return (
    <div className="space-y-2.5 pb-36 animate-fade-in-up">
      {/* Sliding Chip Bar + Expandable Magnifier Search + Smart Config Trigger */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          {/* Expandable Magnifier Search */}
          <button
            onClick={() => {
              setSearchOpen(!searchOpen);
              if (searchOpen) setSearch('');
            }}
            data-testid="reminders_search_toggle"
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen ? 'bg-rose-600 text-white shadow-md' : 'bg-rose-50 text-rose-600'
            }`}
            title="جستجو در رادار یادآوری‌ها"
          >
            {searchOpen ? <X size={16} /> : <Search size={16} />}
          </button>

          {/* Configure Lead Days Button */}
          <button
            onClick={() => setRulesOpen(!rulesOpen)}
            data-testid="reminders_rules_toggle"
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              rulesOpen ? 'bg-amber-500 text-white shadow-md' : 'bg-amber-50 text-amber-700'
            }`}
            title="تنظیم چند روز قبل یادآوری کند"
          >
            <SlidersHorizontal size={16} />
          </button>

          {/* Add New Manual Reminder Button */}
          <button
            onClick={() => { setEditing(null); setSheetOpen(true); }}
            data-testid="add_manual_reminder_button"
            className="w-9 h-9 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-md haptic"
            title="ثبت یادآوری جدید"
          >
            <Plus size={18} />
          </button>

          {/* Horizontal Sliding Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 no-scrollbar">
            {chips.map(c => {
              const active = tabMode === c.v;
              return (
                <button
                  key={c.v}
                  onClick={() => setTabMode(c.v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all haptic ${
                    active
                      ? 'bg-gradient-to-r from-rose-600 to-orange-500 text-white shadow-md shadow-rose-500/25 scale-[1.02]'
                      : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/70'
                  }`}
                >
                  {c.icon}
                  <span>{c.l}</span>
                  {c.count > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                        active ? 'bg-white/25 text-white' : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {c.count.toLocaleString('fa-IR')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Expandable Search Input */}
        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500" />
              <Input
                autoFocus
                placeholder="جستجوی نام بیمار، شماره دندان، شماره چک، کالای انبار، لابراتوار..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 text-xs"
              />
            </div>
          </div>
        )}

        {/* Smart Lead-Days Configuration Panel */}
        {rulesOpen && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-200/80 space-y-2.5 animate-slide-down">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-extrabold text-gray-800">
                تنظیم هوشمند بازه پیش‌هشدار (چند روز قبل از سررسید به شما هشدار دهد؟)
              </span>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rules.autoPilotEnabled}
                  onChange={e => updateRules({ autoPilotEnabled: e.target.checked })}
                  className="accent-emerald-600"
                />
                <span>اتوپایلوت هوشمند (پایش خودکار ۲۴ ساعته)</span>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-[11px]">
              <div className="bg-gray-50 p-2 rounded-xl border border-gray-200/70">
                <span className="text-gray-500 block mb-1 flex items-center gap-1">
                  <FileCheck size={12} className="text-amber-600" /> چک و سفته:
                </span>
                <select
                  value={rules.checkLeadDays}
                  onChange={e => updateRules({ checkLeadDays: Number(e.target.value) })}
                  className="w-full bg-white rounded-lg px-2 py-1 font-bold text-gray-800 border border-gray-200"
                >
                  {[1, 2, 3, 5, 7, 10, 14, 30].map(d => (
                    <option key={d} value={d}>{d.toLocaleString('fa-IR')} روز قبل</option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 p-2 rounded-xl border border-gray-200/70">
                <span className="text-gray-500 block mb-1 flex items-center gap-1">
                  <CreditCard size={12} className="text-emerald-600" /> اقساط ماهانه:
                </span>
                <select
                  value={rules.installmentLeadDays}
                  onChange={e => updateRules({ installmentLeadDays: Number(e.target.value) })}
                  className="w-full bg-white rounded-lg px-2 py-1 font-bold text-gray-800 border border-gray-200"
                >
                  {[1, 2, 3, 5, 7, 10, 14].map(d => (
                    <option key={d} value={d}>{d.toLocaleString('fa-IR')} روز قبل</option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 p-2 rounded-xl border border-gray-200/70">
                <span className="text-gray-500 block mb-1 flex items-center gap-1">
                  <Anchor size={12} className="text-cyan-600" /> مراحل ایمپلنت:
                </span>
                <select
                  value={rules.implantLeadDays}
                  onChange={e => updateRules({ implantLeadDays: Number(e.target.value) })}
                  className="w-full bg-white rounded-lg px-2 py-1 font-bold text-gray-800 border border-gray-200"
                >
                  {[1, 2, 3, 5, 7, 14, 30].map(d => (
                    <option key={d} value={d}>{d.toLocaleString('fa-IR')} روز قبل</option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 p-2 rounded-xl border border-gray-200/70">
                <span className="text-gray-500 block mb-1 flex items-center gap-1">
                  <FlaskConical size={12} className="text-pink-600" /> لابراتوار:
                </span>
                <select
                  value={rules.labLeadDays}
                  onChange={e => updateRules({ labLeadDays: Number(e.target.value) })}
                  className="w-full bg-white rounded-lg px-2 py-1 font-bold text-gray-800 border border-gray-200"
                >
                  {[1, 2, 3, 5, 7].map(d => (
                    <option key={d} value={d}>{d.toLocaleString('fa-IR')} روز قبل</option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 p-2 rounded-xl border border-gray-200/70">
                <span className="text-gray-500 block mb-1 flex items-center gap-1">
                  <CalendarClock size={12} className="text-blue-600" /> نوبت بیمار:
                </span>
                <select
                  value={rules.appointmentLeadDays}
                  onChange={e => updateRules({ appointmentLeadDays: Number(e.target.value) })}
                  className="w-full bg-white rounded-lg px-2 py-1 font-bold text-gray-800 border border-gray-200"
                >
                  {[1, 2, 3, 5, 7].map(d => (
                    <option key={d} value={d}>{d.toLocaleString('fa-IR')} روز قبل</option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 p-2 rounded-xl border border-gray-200/70">
                <span className="text-gray-500 block mb-1 flex items-center gap-1">
                  <Package size={12} className="text-orange-600" /> انقضای انبار:
                </span>
                <select
                  value={rules.inventoryExpiryLeadDays}
                  onChange={e => updateRules({ inventoryExpiryLeadDays: Number(e.target.value) })}
                  className="w-full bg-white rounded-lg px-2 py-1 font-bold text-gray-800 border border-gray-200"
                >
                  {[7, 14, 30, 60, 90].map(d => (
                    <option key={d} value={d}>{d.toLocaleString('fa-IR')} روز قبل</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Executive Smart Radar Summary Banner */}
      <div
        className="bento-tile"
        style={{
          background: 'linear-gradient(135deg, #881337 0%, #BE123C 55%, #E11D48 100%)',
          boxShadow: '0 10px 30px rgba(190, 18, 60, 0.28)',
        }}
      >
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 text-rose-100 text-[10px] font-bold mb-1">
              <Sparkles size={11} />
              <span>رادار هوشمند ۳۶۰ درجه کلینیک مینادنتال</span>
            </div>
            <h2 className="text-base font-black text-white">
              {radarCounts.total.toLocaleString('fa-IR')} رویداد و هشدار فعال در کل بخش‌های مطب
            </h2>
            <p className="text-[11px] text-rose-100/80 mt-0.5">
              پایش همزمان نوبت‌ها، چک صیادی، اقساط، بدهکاران، مراحل ایمپلنت، لابراتوار و موجودی انبار
            </p>
          </div>

          <button
            onClick={handleSyncToDatabase}
            disabled={scanningAll}
            data-testid="smart_auto_scan_reminders_button"
            className="px-3.5 py-2 rounded-xl bg-white text-rose-900 hover:bg-rose-50 text-xs font-extrabold shadow-lg flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
          >
            <Sparkles size={14} className="text-rose-600" />
            {scanningAll ? 'در حال ثبت در دیتابیس...' : 'ثبت خودکار همه در دیتابیس یادآوری'}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-3 pt-2.5 border-t border-white/15 text-center">
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-sm font-black text-white">{radarCounts.critical.toLocaleString('fa-IR')}</p>
            <p className="text-[9px] text-rose-200 font-bold">بحرانی / معوق</p>
          </div>
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-sm font-black text-amber-200">{radarCounts.finance.toLocaleString('fa-IR')}</p>
            <p className="text-[9px] text-rose-200 font-bold">چک / قسط / بدهی</p>
          </div>
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-sm font-black text-cyan-200">{radarCounts.impLab.toLocaleString('fa-IR')}</p>
            <p className="text-[9px] text-rose-200 font-bold">ایمپلنت و لابراتوار</p>
          </div>
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-sm font-black text-orange-200">{radarCounts.inv.toLocaleString('fa-IR')}</p>
            <p className="text-[9px] text-rose-200 font-bold">هشدار انبار</p>
          </div>
        </div>
      </div>

      {scanResult && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5">
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span>{scanResult}</span>
        </div>
      )}

      {/* LIVE RADAR ALERTS VIEW */}
      {tabMode !== 'stored' ? (
        filteredLiveAlerts.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={28} />}
            title="هیچ هشدار یا مورد معوقی در این بخش وجود ندارد"
            subtitle="تمامی امور این بخش در وضعیت سبز و استاندارد قرار دارند"
            color="#10B981"
          />
        ) : (
          <div className="space-y-2.5 stagger">
            {filteredLiveAlerts.map(alert => {
              const u = urgencyStyles[alert.urgency];
              return (
                <div
                  key={alert.id}
                  className="glass-card p-3.5 space-y-2.5 transition-all"
                  style={{ borderRight: `4px solid ${u.border}` }}
                >
                  {/* Top Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <Badge color={u.color} bg={u.bg}>{u.label}</Badge>
                        <span className="text-[10px] font-bold text-gray-500">
                          موعد: {toJalaliStr(alert.dueDate)}
                        </span>
                      </div>
                      <h3 className="text-sm font-extrabold text-gray-800 leading-snug">
                        {alert.title}
                      </h3>
                      <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                        {alert.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Interactive Stage Stepper for Implant Alerts */}
                  {alert.domain === 'implant' && alert.stageEntityId && (
                    <div className="bg-cyan-50/70 border border-cyan-200/80 rounded-2xl p-2.5 space-y-1.5">
                      <p className="text-[10px] font-extrabold text-cyan-900">
                        خط روند زنده ایمپلنت (برای تغییر مرحله کلیک کنید):
                      </p>
                      <div className="flex items-center gap-1 overflow-x-auto pb-1">
                        {IMPLANT_PIPELINE.map((st, idx) => {
                          const currentIdx = IMPLANT_PIPELINE.findIndex(s => s.value === alert.stageCurrent);
                          const isDone = idx < currentIdx;
                          const isCurrent = idx === currentIdx;
                          return (
                            <button
                              key={st.value}
                              onClick={() => handleAdvanceImplantStage(alert.stageEntityId!, st.value)}
                              className={`px-2 py-1 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all haptic ${
                                isCurrent
                                  ? 'bg-cyan-600 text-white shadow-sm scale-105'
                                  : isDone
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-white text-gray-500 border border-gray-200'
                              }`}
                            >
                              {isDone ? '✓ ' : ''}{st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Interactive Stage Stepper for Lab Order Alerts */}
                  {alert.domain === 'lab' && alert.stageEntityId && (
                    <div className="bg-pink-50/70 border border-pink-200/80 rounded-2xl p-2.5 space-y-1.5">
                      <p className="text-[10px] font-extrabold text-pink-900">
                        خط روند زنده لابراتوار (برای تغییر مرحله کلیک کنید):
                      </p>
                      <div className="flex items-center gap-1 overflow-x-auto pb-1">
                        {LAB_PIPELINE.map((st, idx) => {
                          const currentIdx = LAB_PIPELINE.findIndex(s => s.value === alert.stageCurrent);
                          const isDone = idx < currentIdx;
                          const isCurrent = idx === currentIdx;
                          return (
                            <button
                              key={st.value}
                              onClick={() => handleAdvanceLabStage(alert.stageEntityId!, st.value)}
                              className={`px-2.5 py-1 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all haptic ${
                                isCurrent
                                  ? 'bg-pink-600 text-white shadow-sm scale-105'
                                  : isDone
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-white text-gray-500 border border-gray-200'
                              }`}
                            >
                              {isDone ? '✓ ' : ''}{st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons Row */}
                  <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                    {/* Quick Financial Actions */}
                    {alert.domain === 'check' && alert.stageEntityId && (
                      <button
                        onClick={() => handleQuickClearCheck(alert.stageEntityId!)}
                        className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95"
                      >
                        <CheckCircle2 size={13} /> ثبت پاس شدن چک
                      </button>
                    )}

                    {alert.domain === 'installment' && alert.stageEntityId && (
                      <button
                        onClick={() => handleQuickPayInstallment(alert.stageEntityId!)}
                        className="py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95"
                      >
                        <CheckCircle2 size={13} /> ثبت وصول این قسط
                      </button>
                    )}

                    {/* Smart SMS / WhatsApp Generator */}
                    <button
                      onClick={() =>
                        setSmsAlert({
                          patientName: alert.patientName,
                          phone: alert.patientPhone,
                          text: alert.smsTemplate,
                        })
                      }
                      className="py-1.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95"
                    >
                      <MessageSquare size={13} />
                      پیامک / واتساپ هوشمند
                    </button>

                    {/* Direct Phone Call */}
                    {alert.patientPhone && (
                      <a
                        href={`tel:${alert.patientPhone}`}
                        className="py-1.5 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center gap-1 no-underline transition-all"
                      >
                        <Phone size={12} />
                        تماس ({alert.patientPhone})
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* STORED REMINDERS VIEW */
        filteredStoredReminders.length === 0 ? (
          <EmptyState icon={<BellRing size={28} />} title="یادآوری ثبت‌شده‌ای یافت نشد" color="#EF4444" />
        ) : (
          <div className="space-y-2 stagger">
            {filteredStoredReminders.map(r => {
              const patient = getPatient(r.patient_id);
              const status = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending;
              const catColor = CATEGORY_COLORS[r.category] ?? '#6B7280';
              const catLabel = CATEGORIES.find(c => c.value === r.category)?.label ?? r.category;
              const isOverdue = r.reminder_date < today && r.status === 'pending';
              const isToday = r.reminder_date === today;

              return (
                <div
                  key={r.id}
                  className="glass-card p-3"
                  style={{
                    borderRight: isOverdue
                      ? '4px solid #EF4444'
                      : isToday
                      ? '4px solid #F59E0B'
                      : `4px solid ${catColor}`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${catColor}15`, color: catColor }}
                    >
                      <Bell size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <p className="text-sm font-bold text-gray-800">{r.title}</p>
                        <Badge color={catColor} bg={`${catColor}18`}>{catLabel}</Badge>
                        {r.priority === 'urgent' && r.status === 'pending' && (
                          <Badge color="#EF4444" bg="#FEE2E2">فوری</Badge>
                        )}
                      </div>
                      {r.description && <p className="text-xs text-gray-600 mb-1 leading-relaxed">{r.description}</p>}
                      <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                        {patient && (
                          <span className="font-bold text-gray-700">
                            بیمار: {patient.first_name} {patient.last_name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar size={11} /> {toJalaliStr(r.reminder_date)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {r.reminder_time.slice(0, 5)}
                        </span>
                      </div>
                    </div>
                    <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-gray-100 flex-wrap">
                    {r.status !== 'done' && (
                      <>
                        <button
                          onClick={() => handleStatusChange(r.id, 'done')}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold haptic"
                        >
                          <CheckCircle2 size={14} /> انجام شد
                        </button>
                        <button
                          onClick={() => handleSnoozeDays(r, 1)}
                          className="py-1.5 px-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold haptic"
                        >
                          +۱ روز
                        </button>
                        <button
                          onClick={() => handleSnoozeDays(r, 3)}
                          className="py-1.5 px-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold haptic"
                        >
                          +۳ روز
                        </button>
                        <button
                          onClick={() => handleSnoozeDays(r, 7)}
                          className="py-1.5 px-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold haptic"
                        >
                          +۱ هفته
                        </button>
                      </>
                    )}
                    {patient?.phone && (
                      <a
                        href={`tel:${patient.phone}`}
                        className="py-1.5 px-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center gap-1 no-underline"
                      >
                        <Phone size={12} /> تماس
                      </a>
                    )}
                    <button
                      onClick={() => { setEditing(r); setSheetOpen(true); }}
                      className="py-1.5 px-2.5 rounded-xl bg-gray-100 text-gray-600 text-[11px] font-bold haptic"
                    >
                      ویرایش
                    </button>
                    <button
                      onClick={() => setDeleteId(r.id)}
                      className="py-1.5 px-2.5 rounded-xl bg-gray-50 text-gray-400 text-[11px] font-bold haptic"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Smart SMS / WhatsApp Composer Sheet */}
      <Sheet
        open={!!smsAlert}
        onClose={() => {
          setSmsAlert(null);
          setCopiedSms(false);
        }}
        title={smsAlert ? `ارسال پیام هوشمند به ${smsAlert.patientName}` : ''}
        icon={<MessageSquare size={20} />}
        color="#4F46E5"
      >
        {smsAlert && (
          <div className="space-y-3.5">
            <Field label="متن پیام هوشمند آماده ارسال (قابل ویرایش)">
              <Textarea
                rows={4}
                value={smsAlert.text}
                onChange={e => setSmsAlert({ ...smsAlert, text: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(smsAlert.text);
                  setCopiedSms(true);
                  setTimeout(() => setCopiedSms(false), 2000);
                }}
                className="py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
              >
                {copiedSms ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                {copiedSms ? 'کپی شد!' : 'کپی متن پیام'}
              </button>

              {smsAlert.phone && (
                <a
                  href={`sms:${smsAlert.phone}?body=${encodeURIComponent(smsAlert.text)}`}
                  className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 no-underline transition-all"
                >
                  <Send size={14} />
                  ارسال پیامک (SMS)
                </a>
              )}

              {smsAlert.phone && (
                <a
                  href={`https://wa.me/${smsAlert.phone.replace(/^0/, '98')}?text=${encodeURIComponent(smsAlert.text)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 no-underline transition-all"
                >
                  <MessageSquare size={14} />
                  ارسال در واتساپ
                </a>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {actionError && <p className="text-xs text-red-500 bg-red-50 rounded-xl p-2.5">{actionError}</p>}
      <Sheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
        title={editing ? 'ویرایش یادآوری' : 'یادآوری جدید'}
        icon={<BellRing size={20} />}
        color="#EF4444"
      >
        <ReminderForm reminder={editing} patients={patients} onSave={handleSave} saving={saving} />
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف یادآوری"
        message="آیا از حذف این یادآوری اطمینان دارید؟"
        confirmLabel="حذف"
      />
    </div>
  );
}

function ReminderForm({ reminder, patients, onSave, saving }: {
  reminder: Reminder | null;
  patients: Patient[];
  onSave: (d: Partial<Reminder>) => Promise<boolean>;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    patient_id: reminder?.patient_id ?? '',
    title: reminder?.title ?? '',
    description: reminder?.description ?? '',
    reminder_date: reminder?.reminder_date ?? todayGregorian(),
    reminder_time: reminder?.reminder_time ?? '09:00',
    category: reminder?.category ?? 'payment',
    priority: reminder?.priority ?? 'high',
    status: reminder?.status ?? 'pending',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const submit = async () => {
    if (!form.title.trim()) {
      setFormError('عنوان یادآوری را وارد کنید.');
      return;
    }
    setFormError(null);
    const ok = await onSave({
      ...form,
      title: form.title.trim(),
      description: form.description.trim() || null,
      patient_id: form.patient_id || null,
      reminder_time: form.reminder_time || undefined,
    });
    if (!ok) setFormError('ذخیره انجام نشد. لطفاً دوباره تلاش کنید.');
  };

  return (
    <div className="space-y-4">
      <Field label="عنوان"><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="عنوان یادآوری" /></Field>
      <Field label="شرح"><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} placeholder="شرح..." /></Field>
      <Field label="بیمار (اختیاری)">
        <Select
          value={form.patient_id}
          onChange={e => setForm({ ...form, patient_id: e.target.value })}
          options={[
            { value: '', label: 'بدون بیمار' },
            ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` })),
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ یادآوری"><JalaliDatePicker value={form.reminder_date} onChange={v => setForm({ ...form, reminder_date: v })} /></Field>
        <Field label="ساعت"><Input type="time" value={form.reminder_time} onChange={e => setForm({ ...form, reminder_time: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="بخش">
          <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={CATEGORIES} />
        </Field>
        <Field label="اولویت">
          <Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} />
        </Field>
      </div>
      {formError && <p className="text-xs text-red-500 px-1">{formError}</p>}
      <Button onClick={submit} color="#EF4444" disabled={saving} className="w-full">
        {saving ? 'در حال ذخیره...' : 'ذخیره یادآوری'}
      </Button>
    </div>
  );
}
