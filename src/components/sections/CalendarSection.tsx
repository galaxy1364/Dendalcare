import { useState, useMemo } from 'react';
import {
  Calendar as CalendarIcon, ChevronRight, ChevronLeft, Plus, Search, X,
  Clock, CalendarDays, Wallet, ScrollText, CreditCard, Anchor, FlaskConical,
  BellRing, Sparkles, CheckCircle2, ArrowUpLeft, Sun, Moon, Globe,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase,
  type Patient, type Appointment, type Treatment, type LabOrder,
  type Implant, type Reminder, type Installment, type Check as CheckType,
  type Safteh, type Staff,
} from '@/lib/supabase';
import {
  JALALI_MONTHS, JALALI_WEEKDAYS, JALALI_WEEKDAYS_SHORT,
  getMonthMatrix, getJalaliWeekDays, jalaliToGregorianStr,
  todayGregorian, todayJalali, dateStrToJalali, toJalaliFullLabel,
  toHijriStr, toGregorianFaStr, getJalaliDayOccasions, isJalaliLeap,
} from '@/lib/jalali';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Select, Button, Badge, Loading } from '@/components/ui/Form';
import { AppointmentForm } from './AppointmentForm';
import type { SectionId } from '@/lib/sections';

type CalendarViewMode = 'month' | 'week' | 'day' | 'year';

export type DayAggregatedEvent = {
  id: string;
  date: string;
  time?: string;
  title: string;
  subtitle: string;
  category: 'appointment' | 'check' | 'installment' | 'implant' | 'lab' | 'reminder' | 'personal';
  color: string;
  bg: string;
  targetSection: SectionId;
};

export function CalendarSection({ onNavigate }: { onNavigate?: (id: SectionId) => void }) {
  const { data: patients, loading: lp } = useRealtimeTable<Patient>('patients');
  const { data: appointments, loading: la, refresh: refreshAppts } = useRealtimeTable<Appointment>('appointments');
  const { data: treatments } = useRealtimeTable<Treatment>('treatments');
  const { data: labOrders } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: implants } = useRealtimeTable<Implant>('implants');
  const { data: reminders, refresh: refreshReminders } = useRealtimeTable<Reminder>('reminders');
  const { data: installments } = useRealtimeTable<Installment>('installments');
  const { data: checks } = useRealtimeTable<CheckType>('checks');
  const { data: safteh } = useRealtimeTable<Safteh>('safteh');
  const { data: staff } = useRealtimeTable<Staff>('staff');

  const todayStr = todayGregorian();
  const initialJ = todayJalali();

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [jy, setJy] = useState<number>(initialJ.jy);
  const [jm, setJm] = useState<number>(initialJ.jm);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [filterCat, setFilterCat] = useState<string>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Quick 0-to-100 Full-Screen Creation Modals from any selected calendar day
  const [quickApptOpen, setQuickApptOpen] = useState(false);
  const [quickReminderOpen, setQuickReminderOpen] = useState(false);
  const [quickFinanceOpen, setQuickFinanceOpen] = useState(false);
  const [savingQuick, setSavingQuick] = useState(false);

  const [remForm, setRemForm] = useState({
    title: '',
    description: '',
    reminder_time: '09:30',
    category: 'follow_up',
    priority: 'high',
    patient_id: '',
  });

  const [finForm, setFinForm] = useState({
    type: 'income' as 'income' | 'expense',
    amount: '',
    description: '',
    category: 'patient_payment',
    payment_method: 'card',
  });

  const getPatientName = (id: string | null) => {
    if (!id) return 'عمومی';
    const p = patients.find(pt => pt.id === id);
    return p ? `${p.first_name} ${p.last_name}` : 'بیمار';
  };

  // Aggregate 360-degree events from ALL clinic modules + Personal Finance
  const allEvents = useMemo<DayAggregatedEvent[]>(() => {
    const list: DayAggregatedEvent[] = [];

    // 1. Appointments
    for (const apt of appointments) {
      if (apt.status === 'cancelled') continue;
      list.push({
        id: `apt_${apt.id}`,
        date: apt.appointment_date,
        time: apt.appointment_time.slice(0, 5),
        title: `نوبت: ${apt.title || getPatientName(apt.patient_id)}`,
        subtitle: `${getPatientName(apt.patient_id)} • ساعت ${apt.appointment_time.slice(0, 5)} (${apt.duration_min} دقیقه)`,
        category: 'appointment',
        color: '#F59E0B',
        bg: '#FEF3C7',
        targetSection: 'appointments',
      });
    }

    // 2. Checks & Safteh
    for (const chk of checks) {
      if (chk.status !== 'pending') continue;
      list.push({
        id: `chk_${chk.id}`,
        date: chk.due_date,
        title: `سررسید چک ${chk.check_number || ''} (${Number(chk.amount).toLocaleString('fa-IR')} ت)`,
        subtitle: `${getPatientName(chk.patient_id)} • بانک ${chk.bank_name || '-'}`,
        category: 'check',
        color: '#D97706',
        bg: '#FEF3C7',
        targetSection: 'finance',
      });
    }
    for (const sf of safteh) {
      if (sf.status !== 'pending') continue;
      list.push({
        id: `sf_${sf.id}`,
        date: sf.due_date,
        title: `سررسید سفته ${sf.safteh_number || ''} (${Number(sf.amount).toLocaleString('fa-IR')} ت)`,
        subtitle: `${getPatientName(sf.patient_id)} • ضامن: ${sf.guarantor_name || '-'}`,
        category: 'check',
        color: '#6366F1',
        bg: '#E0E7FF',
        targetSection: 'finance',
      });
    }

    // 3. Installments
    for (const inst of installments) {
      if (inst.status !== 'active' || !inst.next_due_date) continue;
      list.push({
        id: `inst_${inst.id}`,
        date: inst.next_due_date,
        title: `سررسید قسط ${getPatientName(inst.patient_id)}`,
        subtitle: `مبلغ قسط: ${Number(inst.monthly_amount).toLocaleString('fa-IR')} تومان (${inst.paid_months}/${inst.total_months})`,
        category: 'installment',
        color: '#22C55E',
        bg: '#DCFCE7',
        targetSection: 'finance',
      });
    }

    // 4. Lab Orders
    for (const lab of labOrders) {
      if (lab.due_date && (lab.status === 'sent' || lab.status === 'in_progress')) {
        list.push({
          id: `lab_${lab.id}`,
          date: lab.due_date,
          title: `تحویل لابراتوار: ${lab.lab_name || 'پروتز'}`,
          subtitle: `${getPatientName(lab.patient_id)} • دندان ${lab.tooth_numbers || '-'}`,
          category: 'lab',
          color: '#EC4899',
          bg: '#FCE7F3',
          targetSection: 'lab',
        });
      }
    }

    // 5. Implants
    for (const imp of implants) {
      const dates: { d: string | null; label: string }[] = [
        { d: imp.placement_date, label: 'جراحی ایمپلنت' },
        { d: imp.osseointegration_date, label: 'چک هیلینگ / اسئواینتگریشن' },
        { d: imp.abutment_date, label: 'نصب اباتمان و قالب‌گیری' },
        { d: imp.crown_date, label: 'تحویل روکش ایمپلنت' },
      ];
      for (const item of dates) {
        if (item.d) {
          list.push({
            id: `imp_${imp.id}_${item.label}`,
            date: item.d,
            title: `${item.label} (دندان ${imp.tooth_number || '-'})`,
            subtitle: `${getPatientName(imp.patient_id)} • برند ${imp.brand || '-'}`,
            category: 'implant',
            color: '#06B6D4',
            bg: '#CFFAFE',
            targetSection: 'implants',
          });
        }
      }
    }

    // 6. Reminders
    for (const rem of reminders) {
      if (rem.status !== 'pending') continue;
      list.push({
        id: `rem_${rem.id}`,
        date: rem.reminder_date,
        time: rem.reminder_time?.slice(0, 5),
        title: `یادآوری: ${rem.title}`,
        subtitle: rem.description || getPatientName(rem.patient_id),
        category: 'reminder',
        color: '#EF4444',
        bg: '#FEE2E2',
        targetSection: 'reminders',
      });
    }

    // 7. Personal Finance Events from LocalStorage
    try {
      const rawPersonal = localStorage.getItem('minadental_personal_finance_v1');
      if (rawPersonal) {
        const pf = JSON.parse(rawPersonal);
        for (const loan of pf.loans || []) {
          if (loan.status === 'active' && loan.nextDueDate) {
            list.push({
              id: `pfloan_${loan.id}`,
              date: loan.nextDueDate,
              title: `قسط وام شخصی: ${loan.title}`,
              subtitle: `بانک ${loan.bankName} • ${Number(loan.monthlyInstallment).toLocaleString('fa-IR')} ت`,
              category: 'personal',
              color: '#8B5CF6',
              bg: '#EDE9FE',
              targetSection: 'finance',
            });
          }
        }
        for (const chk of pf.checks || []) {
          if (chk.status === 'pending' && chk.dueDate) {
            list.push({
              id: `pfchk_${chk.id}`,
              date: chk.dueDate,
              title: `چک شخصی صیادی: ${chk.payee}`,
              subtitle: `${Number(chk.amount).toLocaleString('fa-IR')} تومان • بانک ${chk.bankName}`,
              category: 'personal',
              color: '#8B5CF6',
              bg: '#EDE9FE',
              targetSection: 'finance',
            });
          }
        }
        for (const task of pf.tasks || []) {
          if (!task.done && task.dueDate) {
            list.push({
              id: `pftask_${task.id}`,
              date: task.dueDate,
              title: `کار شخصی: ${task.title}`,
              subtitle: task.notes || 'برنامه شخصی',
              category: 'personal',
              color: '#8B5CF6',
              bg: '#EDE9FE',
              targetSection: 'finance',
            });
          }
        }
      }
    } catch {
      // ignore
    }

    return list;
  }, [appointments, checks, safteh, installments, labOrders, implants, reminders, patients]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, DayAggregatedEvent[]> = {};
    const q = search.trim().toLowerCase();
    for (const ev of allEvents) {
      if (filterCat !== 'all' && ev.category !== filterCat) continue;
      if (q && !ev.title.toLowerCase().includes(q) && !ev.subtitle.toLowerCase().includes(q)) continue;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    return map;
  }, [allEvents, filterCat, search]);

  const selectedDayEvents = useMemo(() => {
    return (eventsByDate[selectedDate] || []).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  }, [eventsByDate, selectedDate]);

  const selectedJalali = useMemo(() => dateStrToJalali(selectedDate), [selectedDate]);
  const selectedOccasions = useMemo(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    const satIdx = (d.getDay() + 1) % 7;
    return getJalaliDayOccasions(selectedJalali.jy, selectedJalali.jm, selectedJalali.jd, satIdx);
  }, [selectedDate, selectedJalali]);

  const monthMatrix = useMemo(() => getMonthMatrix(jy, jm), [jy, jm]);
  const weekDays = useMemo(() => getJalaliWeekDays(selectedDate), [selectedDate]);

  const goPrevMonth = () => {
    if (jm === 1) { setJy(jy - 1); setJm(12); }
    else setJm(jm - 1);
  };

  const goNextMonth = () => {
    if (jm === 12) { setJy(jy + 1); setJm(1); }
    else setJm(jm + 1);
  };

  const goToday = () => {
    const t = todayJalali();
    setJy(t.jy);
    setJm(t.jm);
    setSelectedDate(todayStr);
  };

  const handleSaveQuickAppt = async (data: Partial<Appointment>): Promise<boolean> => {
    setSavingQuick(true);
    const { error } = await supabase.from('appointments').insert(data);
    setSavingQuick(false);
    if (error) return false;
    setQuickApptOpen(false);
    refreshAppts();
    return true;
  };

  const handleSaveQuickReminder = async () => {
    if (!remForm.title.trim()) return;
    setSavingQuick(true);
    await supabase.from('reminders').insert({
      title: remForm.title.trim(),
      description: remForm.description.trim() || null,
      reminder_date: selectedDate,
      reminder_time: remForm.reminder_time,
      category: remForm.category,
      priority: remForm.priority,
      patient_id: remForm.patient_id || null,
      status: 'pending',
    });
    setSavingQuick(false);
    setQuickReminderOpen(false);
    setRemForm({ title: '', description: '', reminder_time: '09:30', category: 'follow_up', priority: 'high', patient_id: '' });
    refreshReminders();
  };

  const handleSaveQuickFinance = async () => {
    if (!finForm.amount || Number(finForm.amount) <= 0) return;
    setSavingQuick(true);
    await supabase.from('finance_transactions').insert({
      type: finForm.type,
      category: finForm.category,
      amount: Number(finForm.amount),
      transaction_date: selectedDate,
      description: finForm.description.trim() || 'ثبت از تقویم کلینیک',
      payment_method: finForm.payment_method,
    });
    setSavingQuick(false);
    setQuickFinanceOpen(false);
    setFinForm({ type: 'income', amount: '', description: '', category: 'patient_payment', payment_method: 'card' });
  };

  if (lp || la) return <Loading color="#D946EF" />;

  return (
    <div className="space-y-3 pb-4 animate-fade-in-up">
      {/* Header + View Switcher Chips */}
      <div className="glass-card p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shrink-0">
              <CalendarIcon size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-base font-black text-gray-800 truncate">تقویم جامع و دائمی فارسی</h1>
                {isJalaliLeap(jy) && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700">
                    سال کبیسه
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 truncate">
                شمسی، میلادی و قمری • متصل به کلیه بخش‌های مطب و مالی شخصی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all haptic ${
                searchOpen ? 'bg-fuchsia-600 text-white shadow-md' : 'bg-fuchsia-50 text-fuchsia-600 hover:bg-fuchsia-100'
              }`}
              title="جستجو در رویدادهای تقویم"
            >
              {searchOpen ? <X size={18} /> : <Search size={18} />}
            </button>
            <button
              onClick={goToday}
              className="px-3 h-10 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white text-xs font-extrabold shadow-md haptic"
            >
              امروز
            </button>
          </div>
        </div>

        {/* Expandable Search */}
        {searchOpen && (
          <div className="relative animate-scale-in">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-fuchsia-500" />
            <Input
              placeholder="جستجو در نوبت‌ها، چک‌ها، اقساط، ایمپلنت یا یادآوری‌ها..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
        )}

        {/* View Mode Sliding Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {[
            { id: 'month' as const, label: 'نمای ماهانه کامل' },
            { id: 'week' as const, label: 'نمای هفتگی' },
            { id: 'day' as const, label: 'نمای روزانه و شیفت‌ها' },
            { id: 'year' as const, label: 'نمای سالانه (۱۲ ماه)' },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setViewMode(v.id)}
              className={`px-3.5 py-2 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic ${
                viewMode === v.id
                  ? 'bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white shadow-md'
                  : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/70'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          {[
            { id: 'all', label: 'همه رویدادها', color: '#9333EA' },
            { id: 'appointment', label: 'نوبت‌ها', color: '#F59E0B' },
            { id: 'check', label: 'چک و سفته', color: '#D97706' },
            { id: 'installment', label: 'اقساط', color: '#22C55E' },
            { id: 'implant', label: 'مراحل ایمپلنت', color: '#06B6D4' },
            { id: 'lab', label: 'لابراتوار', color: '#EC4899' },
            { id: 'reminder', label: 'یادآوری', color: '#EF4444' },
            { id: 'personal', label: 'مالی شخصی', color: '#8B5CF6' },
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setFilterCat(cat.id)}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all ${
                filterCat === cat.id
                  ? 'text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600'
              }`}
              style={filterCat === cat.id ? { background: cat.color } : undefined}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Perpetual Year & Month Navigator Bar */}
      <div className="glass-card p-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={goPrevMonth}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 haptic"
            title="ماه قبل"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={goNextMonth}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 haptic"
            title="ماه بعد"
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={jm}
            onChange={e => setJm(Number(e.target.value))}
            className="bg-fuchsia-50 text-fuchsia-900 font-extrabold text-xs rounded-xl px-2.5 py-1.5 border border-fuchsia-200 focus:outline-none"
          >
            {JALALI_MONTHS.map((mName, idx) => (
              <option key={mName} value={idx + 1}>{mName}</option>
            ))}
          </select>

          <div className="flex items-center bg-purple-50 border border-purple-200 rounded-xl px-1.5 py-1">
            <button
              onClick={() => setJy(jy - 1)}
              className="px-1.5 text-purple-700 font-black text-xs hover:text-purple-950"
              title="سال قبل"
            >
              -
            </button>
            <input
              type="number"
              value={jy}
              onChange={e => {
                const v = Number(e.target.value);
                if (v >= 1200 && v <= 1600) setJy(v);
              }}
              className="w-14 text-center bg-transparent font-black text-xs text-purple-900 focus:outline-none"
            />
            <button
              onClick={() => setJy(jy + 1)}
              className="px-1.5 text-purple-700 font-black text-xs hover:text-purple-950"
              title="سال بعد"
            >
              +
            </button>
          </div>
        </div>

        <div className="text-left hidden sm:block">
          <p className="text-[10px] font-bold text-gray-500">{toGregorianFaStr(selectedDate)}</p>
          <p className="text-[10px] text-amber-700 font-semibold">{toHijriStr(selectedDate)}</p>
        </div>
      </div>

      {/* ==================== 1. MONTH VIEW ==================== */}
      {viewMode === 'month' && (
        <div className="glass-card p-3 space-y-2">
          <div className="grid grid-cols-7 gap-1 text-center pb-1 border-b border-gray-100">
            {JALALI_WEEKDAYS_SHORT.map((w, i) => (
              <div
                key={w}
                className={`text-xs font-extrabold py-1 ${i === 6 ? 'text-rose-500' : 'text-gray-500'}`}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {monthMatrix.map((week, wIdx) => (
              <div key={wIdx} className="grid grid-cols-7 gap-1.5">
                {week.map((cell, cIdx) => {
                  if (!cell.jd || !cell.gregorian) {
                    return <div key={cIdx} className="h-16 rounded-2xl bg-gray-50/40" />;
                  }
                  const isToday = cell.gregorian === todayStr;
                  const isSelected = cell.gregorian === selectedDate;
                  const dayEvents = eventsByDate[cell.gregorian] || [];
                  const occ = getJalaliDayOccasions(jy, jm, cell.jd, cell.weekdayIdx);

                  return (
                    <button
                      key={cIdx}
                      onClick={() => setSelectedDate(cell.gregorian!)}
                      className={`h-16 sm:h-20 rounded-2xl p-1.5 flex flex-col justify-between transition-all haptic relative border text-right ${
                        isSelected
                          ? 'bg-gradient-to-br from-fuchsia-600 to-purple-700 text-white border-fuchsia-400 shadow-lg scale-[1.02]'
                          : isToday
                          ? 'bg-fuchsia-50 border-fuchsia-400 text-fuchsia-950'
                          : occ.isOfficialHoliday
                          ? 'bg-rose-50/70 border-rose-200/80 text-rose-700 hover:bg-rose-100/60'
                          : 'bg-white/90 border-gray-100 text-gray-800 hover:border-purple-200'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`text-xs sm:text-sm font-black leading-none ${
                            isSelected
                              ? 'text-white'
                              : occ.isOfficialHoliday
                              ? 'text-rose-600'
                              : 'text-gray-800'
                          }`}
                        >
                          {cell.jd.toLocaleString('fa-IR')}
                        </span>
                        {dayEvents.length > 0 && (
                          <span
                            className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                              isSelected ? 'bg-white/25 text-white' : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {dayEvents.length.toLocaleString('fa-IR')}
                          </span>
                        )}
                      </div>

                      {/* Occasion tiny label */}
                      {occ.occasions.length > 0 && (
                        <p
                          className={`text-[8px] font-bold truncate w-full leading-tight ${
                            isSelected ? 'text-fuchsia-100' : occ.isOfficialHoliday ? 'text-rose-500' : 'text-purple-600'
                          }`}
                        >
                          {occ.occasions[0].title}
                        </p>
                      )}

                      {/* Event colored dots */}
                      <div className="flex items-center gap-0.5 flex-wrap">
                        {dayEvents.slice(0, 4).map(ev => (
                          <span
                            key={ev.id}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: isSelected ? '#FFFFFF' : ev.color }}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== 2. WEEK VIEW ==================== */}
      {viewMode === 'week' && (
        <div className="glass-card p-3.5 space-y-2.5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-extrabold text-gray-700">نمای هفتگی (شنبه تا جمعه)</h3>
            <span className="text-[11px] text-purple-600 font-bold">
              {JALALI_MONTHS[jm - 1]} {jy.toLocaleString('fa-IR')}
            </span>
          </div>
          <div className="space-y-2">
            {weekDays.map(day => {
              const evs = eventsByDate[day.gregorian] || [];
              const occ = getJalaliDayOccasions(day.jDate.jy, day.jDate.jm, day.jDate.jd, day.weekdayIdx);
              const isSelected = day.gregorian === selectedDate;
              return (
                <div
                  key={day.gregorian}
                  onClick={() => setSelectedDate(day.gregorian)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-fuchsia-50/90 border-fuchsia-400 shadow-sm'
                      : occ.isOfficialHoliday
                      ? 'bg-rose-50/40 border-rose-200'
                      : 'bg-white/90 border-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black ${
                          occ.isOfficialHoliday ? 'bg-rose-500 text-white' : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {day.jDate.jd.toLocaleString('fa-IR')}
                      </span>
                      <div>
                        <p className="text-xs font-extrabold text-gray-800">
                          {day.weekdayLabel} {day.jDate.jd.toLocaleString('fa-IR')} {JALALI_MONTHS[day.jDate.jm - 1]}
                        </p>
                        {occ.occasions.length > 0 && (
                          <p className="text-[10px] font-bold text-rose-600">{occ.occasions.map(o => o.title).join(' • ')}</p>
                        )}
                      </div>
                    </div>
                    <Badge color="#9333EA" bg="#F3E8FF">
                      {evs.length.toLocaleString('fa-IR')} رویداد
                    </Badge>
                  </div>
                  {evs.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-1.5">
                      {evs.map(e => (
                        <span
                          key={e.id}
                          className="text-[10px] font-bold px-2 py-1 rounded-xl"
                          style={{ background: e.bg, color: e.color }}
                        >
                          {e.time ? `${e.time} - ` : ''}{e.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== 3. DAY TIMELINE VIEW ==================== */}
      {viewMode === 'day' && (
        <div className="glass-card p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold text-gray-800">
              جدول ساعتی نوبت‌ها و رویدادهای {toJalaliFullLabel(selectedDate)}
            </h3>
            <button
              onClick={() => setQuickApptOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm haptic"
            >
              <Plus size={13} /> ثبت نوبت
            </button>
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00'].map(slot => {
              const slotEvents = selectedDayEvents.filter(e => e.time === slot);
              return (
                <div
                  key={slot}
                  className="flex items-center gap-2.5 p-2 rounded-xl bg-white/80 border border-gray-100"
                >
                  <span className="text-xs font-mono font-bold text-gray-500 w-12 text-center bg-gray-100 py-1 rounded-lg">
                    {slot}
                  </span>
                  {slotEvents.length === 0 ? (
                    <span className="text-[11px] text-emerald-600 font-semibold">آزاد برای نوبت‌دهی</span>
                  ) : (
                    <div className="flex-1 flex flex-wrap gap-1.5">
                      {slotEvents.map(ev => (
                        <div
                          key={ev.id}
                          className="flex-1 px-2.5 py-1 rounded-xl text-xs font-bold"
                          style={{ background: ev.bg, color: ev.color }}
                        >
                          {ev.title} ({ev.subtitle})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== 4. YEAR 12-MONTH OVERVIEW ==================== */}
      {viewMode === 'year' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {JALALI_MONTHS.map((mName, idx) => {
            const mNum = idx + 1;
            const isCurrentM = mNum === jm;
            return (
              <button
                key={mName}
                onClick={() => {
                  setJm(mNum);
                  setViewMode('month');
                }}
                className={`glass-card p-3.5 text-right transition-all haptic border-2 ${
                  isCurrentM ? 'border-fuchsia-500 bg-fuchsia-50/60' : 'border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-black text-gray-800">{mName}</span>
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                    ماه {mNum.toLocaleString('fa-IR')}
                  </span>
                </div>
                <p className="text-[10px] text-gray-500">
                  مشاهده کامل روزها و مناسبت‌های {mName} {jy.toLocaleString('fa-IR')}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* ==================== SELECTED DAY 360° COMMAND HUB ==================== */}
      <div className="glass-card p-4 space-y-3 border-2 border-purple-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-gray-900">{toJalaliFullLabel(selectedDate)}</h2>
              {selectedOccasions.isOfficialHoliday && (
                <Badge color="#EF4444" bg="#FEE2E2">تعطیل رسمی</Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500 mt-1">
              <span className="flex items-center gap-1"><Globe size={12} className="text-blue-500" /> میلادی: {toGregorianFaStr(selectedDate)}</span>
              <span className="flex items-center gap-1"><Moon size={12} className="text-amber-600" /> قمری: {toHijriStr(selectedDate)}</span>
            </div>
          </div>

          {/* 0-to-100 Direct Action Buttons for Selected Day */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setQuickApptOpen(true)}
              className="px-2.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-extrabold flex items-center gap-1 shadow-sm haptic"
            >
              <Plus size={13} /> ثبت نوبت
            </button>
            <button
              onClick={() => setQuickReminderOpen(true)}
              className="px-2.5 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-extrabold flex items-center gap-1 shadow-sm haptic"
            >
              <Plus size={13} /> ثبت یادآوری
            </button>
            <button
              onClick={() => setQuickFinanceOpen(true)}
              className="px-2.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center gap-1 shadow-sm haptic"
            >
              <Plus size={13} /> تراکنش مالی
            </button>
          </div>
        </div>

        {/* Occasions Banner for Selected Day */}
        {selectedOccasions.occasions.length > 0 && (
          <div className="rounded-2xl bg-gradient-to-r from-fuchsia-50 via-purple-50 to-rose-50 border border-purple-200/70 p-2.5 flex items-center gap-2">
            <Sparkles size={16} className="text-fuchsia-600 shrink-0" />
            <div className="text-xs font-bold text-purple-950">
              مناسبت‌های این روز: {selectedOccasions.occasions.map(o => o.title).join(' ، ')}
            </div>
          </div>
        )}

        {/* Events List for Selected Day */}
        {selectedDayEvents.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs font-bold text-gray-500">هیچ رویداد، نوبت یا سررسیدی برای این تاریخ ثبت نشده است</p>
            <p className="text-[11px] text-gray-400 mt-0.5">از دکمه‌های بالا می‌توانید مستقیماً در همین تاریخ نوبت، یادآوری یا تراکنش ثبت نمایید</p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedDayEvents.map(ev => (
              <div
                key={ev.id}
                onClick={() => onNavigate?.(ev.targetSection)}
                className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/95 border border-gray-100 hover:border-purple-200 transition-all cursor-pointer haptic"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-2.5 h-9 rounded-full shrink-0"
                    style={{ background: ev.color }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-extrabold text-gray-800 truncate">{ev.title}</p>
                      {ev.time && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                          {ev.time}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">{ev.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-bold shrink-0" style={{ color: ev.color }}>
                  <span>مشاهده بخش</span>
                  <ArrowUpLeft size={13} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full-Screen Modal 1: Quick Appointment on Selected Day */}
      <Sheet
        open={quickApptOpen}
        onClose={() => setQuickApptOpen(false)}
        title={`ثبت نوبت هوشمند در ${toJalaliFullLabel(selectedDate)}`}
        icon={<CalendarDays size={20} />}
        color="#F59E0B"
      >
        <AppointmentForm
          appointment={{
            id: '',
            patient_id: '',
            staff_id: staff.find(s => s.role === 'dentist')?.id || null,
            title: '',
            appointment_date: selectedDate,
            appointment_time: '10:00',
            duration_min: 30,
            status: 'scheduled',
            type: 'checkup',
            room: '1',
            notes: null,
            created_at: '',
            updated_at: '',
          }}
          patients={patients}
          appointments={appointments}
          defaultDate={selectedDate}
          onSave={handleSaveQuickAppt}
        />
      </Sheet>

      {/* Full-Screen Modal 2: Quick Reminder on Selected Day */}
      <Sheet
        open={quickReminderOpen}
        onClose={() => setQuickReminderOpen(false)}
        title={`ثبت یادآوری در ${toJalaliFullLabel(selectedDate)}`}
        icon={<BellRing size={20} />}
        color="#EF4444"
      >
        <div className="space-y-4">
          <Field label="عنوان یادآوری">
            <Input
              value={remForm.title}
              onChange={e => setRemForm({ ...remForm, title: e.target.value })}
              placeholder="مثلاً تماس جهت پیگیری جراحی یا سررسید چک..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ساعت یادآوری">
              <Input
                type="time"
                value={remForm.reminder_time}
                onChange={e => setRemForm({ ...remForm, reminder_time: e.target.value })}
              />
            </Field>
            <Field label="بیمار مرتبط (اختیاری)">
              <Select
                value={remForm.patient_id}
                onChange={e => setRemForm({ ...remForm, patient_id: e.target.value })}
                options={[
                  { value: '', label: 'عمومی مطب' },
                  ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` })),
                ]}
              />
            </Field>
          </div>
          <Field label="توضیحات">
            <Input
              value={remForm.description}
              onChange={e => setRemForm({ ...remForm, description: e.target.value })}
              placeholder="توضیحات تکمیلی..."
            />
          </Field>
          <Button
            color="#EF4444"
            className="w-full"
            disabled={savingQuick || !remForm.title.trim()}
            onClick={handleSaveQuickReminder}
          >
            {savingQuick ? 'در حال ثبت...' : 'ثبت یادآوری در تقویم'}
          </Button>
        </div>
      </Sheet>

      {/* Full-Screen Modal 3: Quick Finance Transaction on Selected Day */}
      <Sheet
        open={quickFinanceOpen}
        onClose={() => setQuickFinanceOpen(false)}
        title={`ثبت تراکنش مالی در ${toJalaliFullLabel(selectedDate)}`}
        icon={<Wallet size={20} />}
        color="#22C55E"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setFinForm({ ...finForm, type: 'income' })}
              className={`py-2.5 rounded-xl text-xs font-extrabold border transition-all ${
                finForm.type === 'income'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-gray-50 text-gray-600 border-gray-200'
              }`}
            >
              درآمد مطب
            </button>
            <button
              onClick={() => setFinForm({ ...finForm, type: 'expense' })}
              className={`py-2.5 rounded-xl text-xs font-extrabold border transition-all ${
                finForm.type === 'expense'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-gray-50 text-gray-600 border-gray-200'
              }`}
            >
              هزینه مطب
            </button>
          </div>
          <Field label="مبلغ (تومان)">
            <Input
              type="number"
              value={finForm.amount}
              onChange={e => setFinForm({ ...finForm, amount: e.target.value })}
              placeholder="مبلغ به تومان..."
            />
          </Field>
          <Field label="شرح تراکنش">
            <Input
              value={finForm.description}
              onChange={e => setFinForm({ ...finForm, description: e.target.value })}
              placeholder="شرح دریافت یا پرداخت..."
            />
          </Field>
          <Button
            color="#22C55E"
            className="w-full"
            disabled={savingQuick || !finForm.amount}
            onClick={handleSaveQuickFinance}
          >
            {savingQuick ? 'در حال ثبت...' : 'ثبت تراکنش در تقویم'}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
