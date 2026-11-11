import { useState, useMemo } from 'react';
import {
  CalendarDays, Plus, ChevronRight, ChevronLeft,
  CheckCircle2, XCircle, Play, UserX, BadgeCheck,
  MessageSquare, AlertTriangle, Search, X, PhoneIncoming,
  Sparkles, Clock, Layers, UserPlus, ShieldCheck,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { supabase, type Appointment, type Patient } from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Badge, EmptyState, Loading, Button } from '@/components/ui/Form';
import { AppointmentForm, type AppointmentPayload } from '@/components/sections/AppointmentForm';
import {
  dateStrToJalali, faDayNames, jalaliToFa, toJalaliStr,
  todayGregorian, shiftGregorianDate,
} from '@/lib/jalali';
import {
  APT_TYPES, CLINIC_UNITS, APPOINTMENT_STATUS,
  minutesToTime, timeToMinutes, suggestFreeTimeSlots, findSmartConflicts,
} from '@/lib/appointments';

const STATUS_ACTIONS: Record<string, { status: string; label: string; icon: React.ReactNode; className: string }[]> = {
  scheduled: [
    { status: 'confirmed', label: 'تایید', icon: <BadgeCheck size={13} />, className: 'bg-emerald-50 text-emerald-600' },
    { status: 'cancelled', label: 'لغو', icon: <XCircle size={13} />, className: 'bg-red-50 text-red-500' },
  ],
  confirmed: [
    { status: 'in_progress', label: 'شروع درمان', icon: <Play size={13} />, className: 'bg-blue-50 text-blue-600' },
    { status: 'no_show', label: 'غیبت', icon: <UserX size={13} />, className: 'bg-gray-100 text-gray-500' },
    { status: 'cancelled', label: 'لغو', icon: <XCircle size={13} />, className: 'bg-red-50 text-red-500' },
  ],
  in_progress: [
    { status: 'completed', label: 'تکمیل', icon: <CheckCircle2 size={13} />, className: 'bg-green-50 text-green-600' },
    { status: 'cancelled', label: 'لغو', icon: <XCircle size={13} />, className: 'bg-red-50 text-red-500' },
  ],
};

type ApptTabMode = 'daily' | 'units' | 'caller_id' | 'free_slots';

export function Appointments() {
  const { data: appointments, loading, refresh } = useRealtimeTable<Appointment>('appointments');
  const { data: patients, refresh: refreshPatients } = useRealtimeTable<Patient>('patients');

  const [tabMode, setTabMode] = useState<ApptTabMode>('daily');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentDate, setCurrentDate] = useState(todayGregorian());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [preselectedPatientId, setPreselectedPatientId] = useState<string>('');
  const [formKey, setFormKey] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Caller ID Lookup & Auto-Booking state
  const [incomingPhone, setIncomingPhone] = useState('');
  const [quickNewPatientOpen, setQuickNewPatientOpen] = useState(false);
  const [quickFirstName, setQuickFirstName] = useState('');
  const [quickLastName, setQuickLastName] = useState('');
  const [quickFileNo, setQuickFileNo] = useState('');
  const [savingQuickPatient, setSavingQuickPatient] = useState(false);

  const today = todayGregorian();

  const weekDays = useMemo(() => {
    const jsDay = new Date(currentDate + 'T00:00:00').getDay();
    const iranDayOfWeek = (jsDay + 1) % 7;
    const start = shiftGregorianDate(currentDate, -iranDayOfWeek);
    return Array.from({ length: 7 }, (_, i) => {
      const ds = shiftGregorianDate(start, i);
      const weekday = new Date(ds + 'T00:00:00').getDay();
      return {
        date: ds,
        day: dateStrToJalali(ds).jd,
        dayName: faDayNames[weekday],
        isToday: ds === today,
        count: appointments.filter((a) => a.appointment_date === ds && a.status !== 'cancelled').length,
      };
    });
  }, [currentDate, appointments, today]);

  const dayAppts = useMemo(() => {
    let list = appointments
      .filter((a) => a.appointment_date === currentDate)
      .sort((a, b) => a.appointment_time.localeCompare(b.appointment_time));
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((a) => {
        const p = patients.find((pt) => pt.id === a.patient_id);
        const pName = p ? `${p.first_name} ${p.last_name}`.toLowerCase() : '';
        return (
          pName.includes(q) ||
          (p?.phone && p.phone.includes(q)) ||
          (a.room && a.room.toLowerCase().includes(q)) ||
          a.type.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [appointments, currentDate, searchQuery, patients]);

  const weekStats = useMemo(() => {
    const weekDates = weekDays.map((w) => w.date);
    const weekAppts = appointments.filter((a) => weekDates.includes(a.appointment_date));
    return {
      total: weekAppts.length,
      today: appointments.filter((a) => a.appointment_date === today).length,
      completed: weekAppts.filter((a) => a.status === 'completed').length,
      pending: weekAppts.filter((a) => a.status === 'scheduled' || a.status === 'confirmed').length,
    };
  }, [appointments, weekDays, today]);

  const dayFreeSlots = useMemo(() => {
    return suggestFreeTimeSlots(appointments, currentDate, 30, null, { bufferMin: 10 });
  }, [appointments, currentDate]);

  // Caller ID matched patient
  const matchedCallerPatient = useMemo(() => {
    const clean = incomingPhone.replace(/\D/g, '');
    if (clean.length < 4) return null;
    return (
      patients.find((p) => {
        const pPhone = (p.phone || '').replace(/\D/g, '');
        return pPhone && (pPhone.includes(clean) || clean.includes(pPhone));
      }) ?? null
    );
  }, [incomingPhone, patients]);

  const getPatient = (id: string | null) => patients.find((p) => p.id === id);

  const navigateDay = (delta: number) => setCurrentDate(shiftGregorianDate(currentDate, delta));
  const navigateWeek = (delta: number) => setCurrentDate(shiftGregorianDate(currentDate, delta * 7));

  const openNew = (patientId = '') => {
    setEditing(null);
    setPreselectedPatientId(patientId);
    setFormKey((k) => k + 1);
    setSheetOpen(true);
  };

  const openEdit = (apt: Appointment) => {
    setEditing(apt);
    setPreselectedPatientId(apt.patient_id ?? '');
    setFormKey((k) => k + 1);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
    setPreselectedPatientId('');
  };

  const handleSave = async (payload: AppointmentPayload): Promise<boolean> => {
    const result = editing
      ? await supabase.from('appointments').update(payload).eq('id', editing.id)
      : await supabase.from('appointments').insert(payload);
    if (result.error) return false;
    closeSheet();
    setCurrentDate(payload.appointment_date);
    refresh();
    return true;
  };

  const handleQuickCreatePatientAndBook = async () => {
    if (!quickFirstName.trim()) return;
    setSavingQuickPatient(true);
    const notesWithFileNo = quickFileNo.trim() ? `[شماره پرونده: ${quickFileNo.trim()}]` : null;
    const { data: created, error } = await supabase
      .from('patients')
      .insert({
        first_name: quickFirstName.trim(),
        last_name: quickLastName.trim() || '—',
        phone: incomingPhone.trim() || null,
        gender: 'unknown',
        status: 'active',
        notes: notesWithFileNo,
      })
      .select('*')
      .single();
    setSavingQuickPatient(false);
    if (error || !created) return;
    setQuickNewPatientOpen(false);
    setQuickFirstName('');
    setQuickLastName('');
    setQuickFileNo('');
    await refreshPatients();
    openNew(created.id);
  };

  const handleStatusChange = async (id: string, status: string) => {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
    if (error) {
      setActionError('تغییر وضعیت نوبت انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('appointments').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      setActionError('حذف نوبت انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  if (loading) return <Loading color="#F59E0B" />;

  const isToday = currentDate === today;
  const currentDayName = faDayNames[new Date(currentDate + 'T00:00:00').getDay()];

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* Top Sliding Chip Bar + Magnifier Search + Full-Screen New Button */}
      <div className="glass-card p-3">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg">
              <CalendarDays size={20} />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-gray-800">سیستم هوشمند نوبت‌دهی و ضدتداخل</h1>
              <p className="text-[10px] text-gray-500">
                {jalaliToFa(dayAppts.length)} نوبت این روز • {jalaliToFa(dayFreeSlots.length)} بازه خالی پیشنهادی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (searchOpen) setSearchQuery('');
              }}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all haptic ${
                searchOpen ? 'bg-amber-600 text-white shadow-md' : 'bg-amber-50 text-amber-700'
              }`}
              title="جستجو در نوبت‌ها"
            >
              {searchOpen ? <X size={18} /> : <Search size={18} />}
            </button>
            <button
              onClick={() => openNew('')}
              aria-label="نوبت جدید"
              data-testid="new_appointment_fullscreen_btn"
              className="px-3.5 h-10 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-lg haptic"
            >
              <Plus size={18} />
              <span>نوبت جدید</span>
            </button>
          </div>
        </div>

        {/* Sliding Module Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
          {[
            { id: 'daily' as const, label: 'نوبت‌های روز', icon: <CalendarDays size={13} />, badge: dayAppts.length },
            { id: 'units' as const, label: 'تفکیک یونیت‌ها و تداخل‌سنج', icon: <Layers size={13} /> },
            { id: 'caller_id' as const, label: 'تشخیص تماس بیمار (Caller ID)', icon: <PhoneIncoming size={13} /> },
            { id: 'free_slots' as const, label: 'زمان‌های خالی امروز', icon: <Sparkles size={13} />, badge: dayFreeSlots.length },
          ].map((chip) => {
            const active = tabMode === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => setTabMode(chip.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all haptic ${
                  active
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md scale-[1.02]'
                    : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/70'
                }`}
              >
                {chip.icon}
                <span>{chip.label}</span>
                {chip.badge !== undefined && chip.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      active ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {jalaliToFa(chip.badge)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {searchOpen && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600" />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی نام بیمار، شماره تماس، یونیت یا نوع درمان..."
                className="pr-9 text-xs"
              />
            </div>
          </div>
        )}

        {/* Week Strip Navigator */}
        <div className="flex items-center gap-1 mt-3 mb-1">
          <button
            onClick={() => navigateWeek(-1)}
            aria-label="هفته قبل"
            className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center haptic shrink-0"
          >
            <ChevronRight size={16} className="text-gray-500" />
          </button>
          <div className="flex-1 flex gap-1 justify-between">
            {weekDays.map((w) => (
              <button
                key={w.date}
                onClick={() => setCurrentDate(w.date)}
                className={`flex-1 rounded-xl py-1.5 px-1 text-center transition-all haptic ${
                  w.date === currentDate
                    ? 'bg-amber-500 text-white shadow-md'
                    : w.isToday
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-50 text-gray-500'
                }`}
              >
                <p className="text-[8px] font-semibold opacity-70 leading-none mb-0.5">{w.dayName.slice(0, 2)}</p>
                <p className="text-sm font-black leading-none">{jalaliToFa(w.day)}</p>
                {w.count > 0 && (
                  <span
                    className={`inline-block mt-0.5 text-[7px] font-bold px-1 rounded-full ${
                      w.date === currentDate ? 'bg-white/25' : 'bg-amber-200 text-amber-700'
                    }`}
                  >
                    {jalaliToFa(w.count)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => navigateWeek(1)}
            aria-label="هفته بعد"
            className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center haptic shrink-0"
          >
            <ChevronLeft size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 mt-2">
          <button
            onClick={() => navigateDay(-1)}
            aria-label="روز قبل"
            className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center haptic"
          >
            <ChevronRight size={18} className="text-gray-600" />
          </button>
          <div className="flex-1 text-center">
            <p className="text-sm font-bold text-gray-700">
              {currentDayName} • {toJalaliStr(currentDate)}
            </p>
            <div className="flex items-center justify-center gap-1.5 mt-1">
              <button
                onClick={() => setCurrentDate(today)}
                className={`text-[10px] px-2.5 py-0.5 rounded-full transition-all ${
                  isToday ? 'bg-amber-500 text-white font-bold shadow-sm' : 'bg-gray-100 text-gray-600'
                }`}
              >
                امروز
              </button>
              <button
                onClick={() => setCurrentDate(shiftGregorianDate(today, 1))}
                className={`text-[10px] px-2.5 py-0.5 rounded-full transition-all ${
                  currentDate === shiftGregorianDate(today, 1)
                    ? 'bg-amber-500 text-white font-bold shadow-sm'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                فردا
              </button>
              <button
                onClick={() => setCurrentDate(shiftGregorianDate(today, 2))}
                className={`text-[10px] px-2.5 py-0.5 rounded-full transition-all ${
                  currentDate === shiftGregorianDate(today, 2)
                    ? 'bg-amber-500 text-white font-bold shadow-sm'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                پس‌فردا
              </button>
            </div>
          </div>
          <button
            onClick={() => navigateDay(1)}
            aria-label="روز بعد"
            className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center haptic"
          >
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* CALLER ID SMART PANEL */}
      {tabMode === 'caller_id' && (
        <div className="glass-card p-4 space-y-3 border-2 border-amber-300/80 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-md">
                <PhoneIncoming size={20} />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-gray-800">تشخیص هوشمند تماس بیمار (Caller ID)</h3>
                <p className="text-[11px] text-gray-500">
                  هنگام تماس بیمار شماره را وارد کنید تا پرونده بالا بیاید یا نوبت فوری پیشنهاد شود
                </p>
              </div>
            </div>
          </div>

          <Field label="شماره تماس ورودی بیمار">
            <Input
              dir="ltr"
              value={incomingPhone}
              onChange={(e) => setIncomingPhone(e.target.value)}
              placeholder="0912..."
              className="text-center font-mono font-bold text-base tracking-wider"
            />
          </Field>

          {/* Quick Simulation Chips from Existing Patients */}
          {patients.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-gray-400 font-semibold">تست سریع تماس بیماران فعلی:</span>
              {patients
                .filter((p) => p.phone)
                .slice(0, 4)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setIncomingPhone(p.phone || '')}
                    className="px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200"
                  >
                    📞 {p.first_name} {p.last_name} ({p.phone})
                  </button>
                ))}
            </div>
          )}

          {incomingPhone.replace(/\D/g, '').length >= 4 && (
            <div className="pt-2">
              {matchedCallerPatient ? (
                <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-200/70 px-2 py-0.5 rounded-full">
                        پرونده بیمار شناسایی شد
                      </span>
                      <h4 className="text-base font-black text-gray-900 mt-1">
                        {matchedCallerPatient.first_name} {matchedCallerPatient.last_name}
                      </h4>
                      <p className="text-xs text-gray-600">
                        تلفن: {matchedCallerPatient.phone || '—'} • کد ملی:{' '}
                        {matchedCallerPatient.national_id || 'ثبت‌نشده'}
                      </p>
                    </div>
                    <CheckCircle2 size={28} className="text-emerald-600 shrink-0" />
                  </div>
                  <Button
                    color="#10B981"
                    onClick={() => openNew(matchedCallerPatient.id)}
                    className="w-full"
                    icon={<CalendarDays size={16} />}
                  >
                    پیشنهاد و ثبت نوبت فوری برای {matchedCallerPatient.first_name} {matchedCallerPatient.last_name}
                  </Button>
                </div>
              ) : (
                <div className="rounded-2xl bg-amber-50 border-2 border-amber-300 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-extrabold text-amber-800 bg-amber-200/70 px-2 py-0.5 rounded-full">
                        بیمار جدید (فاقد پرونده قبلی)
                      </span>
                      <h4 className="text-sm font-black text-gray-900 mt-1">
                        شماره {incomingPhone} در سیستم پرونده ندارد
                      </h4>
                      <p className="text-xs text-gray-600">
                        با یک کلیک پرونده سریع تشکیل دهید و همزمان نوبت بدون تداخل ثبت کنید.
                      </p>
                    </div>
                    <UserPlus size={26} className="text-amber-600 shrink-0" />
                  </div>
                  <Button
                    color="#F59E0B"
                    onClick={() => setQuickNewPatientOpen(true)}
                    className="w-full"
                    icon={<UserPlus size={16} />}
                  >
                    تشکیل پرونده سریع و تعیین نوبت اتوماتیک (فول‌اسکرین)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* FREE SLOTS RADAR TAB */}
      {tabMode === 'free_slots' && (
        <div className="glass-card p-4 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-gray-800 flex items-center gap-1.5">
              <Sparkles size={16} className="text-amber-500" />
              بازه‌های زمانی آزاد در تاریخ {toJalaliStr(currentDate)}
            </h3>
            <Badge color="#10B981" bg="#D1FAE5">
              {jalaliToFa(dayFreeSlots.length)} نوبت خالی
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {dayFreeSlots.map((slot) => (
              <button
                key={slot.time}
                onClick={() => openNew('')}
                className="p-2.5 rounded-2xl bg-emerald-50/80 hover:bg-emerald-100 border border-emerald-200 text-right transition-all haptic"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-emerald-800">
                    {slot.time.replace(/\d/g, (d) => jalaliToFa(Number(d)))}
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white text-emerald-700">
                    {slot.shiftLabel}
                  </span>
                </div>
                <p className="text-[10px] text-emerald-600 mt-1">
                  تا ساعت {slot.endTime.replace(/\d/g, (d) => jalaliToFa(Number(d)))} • آماده رزرو
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* UNITS TIMELINE TAB */}
      {tabMode === 'units' && (
        <div className="space-y-2.5 animate-fade-in">
          {CLINIC_UNITS.map((unit) => {
            const unitAppts = dayAppts.filter(
              (a) => (a.room || CLINIC_UNITS[0].value) === unit.value
            );
            return (
              <div key={unit.value} className="glass-card p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-gray-800 flex items-center gap-1.5">
                    <Layers size={14} className="text-amber-600" />
                    {unit.label}
                  </span>
                  <Badge color="#F59E0B" bg="#FEF3C7">
                    {jalaliToFa(unitAppts.length)} نوبت فعال
                  </Badge>
                </div>
                {unitAppts.length === 0 ? (
                  <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                    <ShieldCheck size={13} /> تمام ساعات این یونیت در این تاریخ آزاد است
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {unitAppts.map((apt) => {
                      const p = getPatient(apt.patient_id);
                      const st = apt.appointment_time.slice(0, 5);
                      const et = minutesToTime(timeToMinutes(st) + apt.duration_min);
                      return (
                        <div
                          key={apt.id}
                          onClick={() => openEdit(apt)}
                          className="flex items-center justify-between p-2 rounded-xl bg-amber-50/70 border border-amber-200/80 cursor-pointer"
                        >
                          <span className="text-xs font-bold text-gray-800">
                            {p ? `${p.first_name} ${p.last_name}` : 'بیمار'}
                          </span>
                          <span className="text-xs font-mono font-bold text-amber-700">
                            {st.replace(/\d/g, (d) => jalaliToFa(Number(d)))} -{' '}
                            {et.replace(/\d/g, (d) => jalaliToFa(Number(d)))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary KPI Row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card p-2 text-center">
          <p className="text-base font-black text-amber-500">{jalaliToFa(weekStats.today)}</p>
          <p className="text-[9px] text-gray-400">نوبت‌های امروز</p>
        </div>
        <div className="glass-card p-2 text-center">
          <p className="text-base font-black text-green-500">{jalaliToFa(weekStats.completed)}</p>
          <p className="text-[9px] text-gray-400">تکمیل‌شده این هفته</p>
        </div>
        <div className="glass-card p-2 text-center">
          <p className="text-base font-black text-blue-500">{jalaliToFa(weekStats.pending)}</p>
          <p className="text-[9px] text-gray-400">در انتظار این هفته</p>
        </div>
      </div>

      {actionError && <p className="text-xs text-red-500 bg-red-50 rounded-xl p-2.5">{actionError}</p>}

      {/* Daily Appointments List */}
      {dayAppts.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={28} />}
          title="نوبتی برای این روز ثبت نشده"
          subtitle="برای ثبت نوبت جدید بدون تداخل روی «+ نوبت جدید» بزنید"
          color="#F59E0B"
        />
      ) : (
        <div className="space-y-2 stagger">
          {dayAppts.map((apt) => {
            const patient = getPatient(apt.patient_id);
            const status = APPOINTMENT_STATUS[apt.status] ?? APPOINTMENT_STATUS.scheduled;
            const typeLabel = APT_TYPES.find((t) => t.value === apt.type)?.label ?? apt.type;
            const startTime = apt.appointment_time.slice(0, 5);
            const endTime = minutesToTime(timeToMinutes(startTime) + apt.duration_min);
            const actions = STATUS_ACTIONS[apt.status] ?? [];

            const conflicts = findSmartConflicts(
              dayAppts,
              apt.appointment_date,
              startTime,
              apt.duration_min,
              apt.id,
              { room: apt.room }
            );
            const hasConflict = conflicts.length > 0;

            return (
              <div
                key={apt.id}
                className="glass-card p-3"
                style={{ borderRight: `3px solid ${hasConflict ? '#EF4444' : status.color}` }}
              >
                <button onClick={() => openEdit(apt)} className="w-full text-right">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center justify-center w-14 shrink-0">
                      <span className="text-base font-black text-amber-500">
                        {startTime.replace(/\d/g, (d) => jalaliToFa(Number(d)))}
                      </span>
                      <span className="text-[9px] text-gray-400">
                        تا {endTime.replace(/\d/g, (d) => jalaliToFa(Number(d)))}
                      </span>
                    </div>
                    <div className="w-px h-10 bg-gray-200" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-gray-800 truncate">
                          {patient ? `${patient.first_name} ${patient.last_name}` : 'بیمار نامشخص'}
                        </p>
                        {hasConflict && (
                          <span className="text-[10px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                            <AlertTriangle size={11} /> {conflicts[0].reasonLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <Badge color="#F59E0B" bg="#FEF3C7">
                          {typeLabel}
                        </Badge>
                        <Badge color={status.color} bg={status.bg}>
                          {status.label}
                        </Badge>
                        {apt.room && (
                          <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            {apt.room}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
                  {actions.map((a) => (
                    <button
                      key={a.status}
                      onClick={() => handleStatusChange(apt.id, a.status)}
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-bold haptic ${a.className}`}
                    >
                      {a.icon} {a.label}
                    </button>
                  ))}
                  {patient?.phone && (
                    <a
                      href={`sms:${patient.phone}?body=${encodeURIComponent(
                        `سلام ${patient.first_name} عزیز، یادآوری نوبت دندانپزشکی در کلینیک مینادنتال: روز ${toJalaliStr(
                          apt.appointment_date
                        )} ساعت ${startTime}`
                      )}`}
                      className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-sky-50 text-sky-600 hover:bg-sky-100 haptic"
                    >
                      <MessageSquare size={12} />
                      پیامک
                    </a>
                  )}
                  <button
                    onClick={() => setDeleteId(apt.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-gray-50 text-gray-400 text-[11px] font-bold haptic"
                  >
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full-Screen New / Edit Appointment Sheet */}
      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        title={editing ? 'ویرایش هوشمند نوبت' : 'ثبت نوبت جدید (ضدتداخل هوشمند)'}
        subtitle="بررسی خودکار تداخل یونیت، پزشک و زمان استریل"
        icon={<CalendarDays size={20} />}
        color="#F59E0B"
      >
        <AppointmentForm
          key={formKey}
          appointment={editing}
          appointments={appointments}
          patients={patients}
          defaultDate={currentDate}
          preselectedPatientId={preselectedPatientId}
          onSave={handleSave}
        />
      </Sheet>

      {/* Full-Screen Quick New Patient from Caller ID */}
      <Sheet
        open={quickNewPatientOpen}
        onClose={() => setQuickNewPatientOpen(false)}
        title="تشکیل سریع پرونده از تماس ورودی و تعیین نوبت"
        subtitle={`شماره تماس: ${incomingPhone}`}
        icon={<UserPlus size={20} />}
        color="#10B981"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="نام بیمار">
              <Input
                value={quickFirstName}
                onChange={(e) => setQuickFirstName(e.target.value)}
                placeholder="نام"
              />
            </Field>
            <Field label="نام خانوادگی">
              <Input
                value={quickLastName}
                onChange={(e) => setQuickLastName(e.target.value)}
                placeholder="نام خانوادگی"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="شماره موبایل">
              <Input
                dir="ltr"
                value={incomingPhone}
                onChange={(e) => setIncomingPhone(e.target.value)}
                placeholder="0912..."
              />
            </Field>
            <Field label="شماره پرونده دستی (اختیاری)">
              <Input
                value={quickFileNo}
                onChange={(e) => setQuickFileNo(e.target.value)}
                placeholder="مثلاً 1403-108"
              />
            </Field>
          </div>
          <Button
            color="#10B981"
            disabled={savingQuickPatient || !quickFirstName.trim()}
            onClick={handleQuickCreatePatientAndBook}
            className="w-full"
          >
            {savingQuickPatient ? 'در حال ثبت پرونده...' : 'ذخیره پرونده و انتقال به فرم تعیین نوبت'}
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف نوبت"
        message="آیا از حذف این نوبت اطمینان دارید؟"
        confirmLabel="حذف"
      />
    </div>
  );
}
