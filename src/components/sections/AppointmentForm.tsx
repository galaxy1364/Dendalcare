import { useState, useMemo } from 'react';
import { AlertTriangle, Sparkles, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import type { Appointment, Patient } from '@/lib/supabase';
import { Field, Input, Textarea, Select, Button } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import {
  APT_TYPES,
  CLINIC_UNITS,
  APPOINTMENT_STATUS,
  findSmartConflicts,
  suggestFreeTimeSlots,
  minutesToTime,
  timeToMinutes,
} from '@/lib/appointments';
import { jalaliToFa } from '@/lib/jalali';
import { loadDentalUnits } from '@/lib/clinicDefinitions';

export type AppointmentPayload = {
  patient_id: string;
  appointment_date: string;
  appointment_time: string;
  duration_min: number;
  type: string;
  status: string;
  notes: string | null;
  room: string | null;
};

type Props = {
  appointment: Appointment | null;
  appointments: Appointment[];
  patients: Patient[];
  defaultDate: string;
  preselectedPatientId?: string;
  onSave: (payload: AppointmentPayload) => Promise<boolean>;
};

export function AppointmentForm({
  appointment,
  appointments,
  patients,
  defaultDate,
  preselectedPatientId,
  onSave,
}: Props) {
  const [patientId, setPatientId] = useState(appointment?.patient_id ?? preselectedPatientId ?? '');
  const [patientSearch, setPatientSearch] = useState('');
  const [date, setDate] = useState(appointment?.appointment_date ?? defaultDate);
  const [time, setTime] = useState(appointment?.appointment_time.slice(0, 5) ?? '09:30');
  const [duration, setDuration] = useState(appointment?.duration_min ?? 30);
  const [type, setType] = useState(appointment?.type ?? 'checkup');
  const [status, setStatus] = useState(appointment?.status ?? 'scheduled');
  const [room, setRoom] = useState(appointment?.room ?? CLINIC_UNITS[0].value);
  const [sterilBuffer, setSterilBuffer] = useState<number>(10);
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        p.phone?.includes(q) ||
        p.national_id?.includes(q)
    );
  }, [patients, patientSearch]);

  const durationValid = Number.isInteger(duration) && duration >= 5 && duration <= 480;
  const endTime = time && durationValid ? minutesToTime(timeToMinutes(time) + duration) : '';

  const smartConflicts = useMemo(() => {
    if (!date || !time || !durationValid) return [];
    return findSmartConflicts(appointments, date, time, duration, appointment?.id ?? null, {
      room,
      patientId: patientId || null,
      bufferMin: sterilBuffer,
    });
  }, [appointments, date, time, duration, durationValid, appointment, room, patientId, sterilBuffer]);

  const freeSlots = useMemo(() => {
    if (!date || !durationValid) return [];
    return suggestFreeTimeSlots(appointments, date, duration, appointment?.id ?? null, {
      room,
      bufferMin: sterilBuffer,
    });
  }, [appointments, date, duration, durationValid, appointment, room, sterilBuffer]);

  const primaryConflict = smartConflicts[0] ?? null;
  const conflictPatient = primaryConflict
    ? patients.find((p) => p.id === primaryConflict.appointment.patient_id)
    : undefined;
  const conflictName = conflictPatient
    ? `${conflictPatient.first_name} ${conflictPatient.last_name}`
    : 'بیمار دیگر';

  const handleTypeChange = (newType: string) => {
    setType(newType);
    const found = APT_TYPES.find((t) => t.value === newType);
    if (found && !appointment) {
      setDuration(found.defaultDuration);
    }
  };

  const submit = async () => {
    if (!patientId) {
      setError('لطفاً بیمار را انتخاب کنید.');
      return;
    }
    if (!date || !time) {
      setError('تاریخ و ساعت نوبت را وارد کنید.');
      return;
    }
    if (!durationValid) {
      setError('مدت نوبت باید بین ۵ تا ۴۸۰ دقیقه باشد.');
      return;
    }
    if (smartConflicts.length > 0) {
      setError('تداخل زمانی وجود دارد. لطفاً یکی از زمان‌های خالی پیشنهادی را انتخاب کنید.');
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await onSave({
      patient_id: patientId,
      appointment_date: date,
      appointment_time: time,
      duration_min: duration,
      type,
      status,
      notes: notes.trim() || null,
      room: room.trim() || null,
    });
    setSaving(false);
    if (!ok) setError('ذخیره انجام نشد. لطفاً دوباره تلاش کنید.');
  };

  return (
    <div className="space-y-4">
      {/* Patient Search + Selector */}
      <div className="rounded-2xl bg-amber-50/60 border border-amber-200/80 p-3 space-y-2.5">
        <Field label="جستجو و انتخاب سریع بیمار">
          <Input
            value={patientSearch}
            onChange={(e) => setPatientSearch(e.target.value)}
            placeholder="نام، شماره موبایل یا کد ملی بیمار را تایپ کنید..."
            className="mb-1.5 text-xs"
          />
          <Select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            options={[
              { value: '', label: `انتخاب از بین ${jalaliToFa(filteredPatients.length)} بیمار...` },
              ...filteredPatients.map((p) => ({
                value: p.id,
                label: `${p.first_name} ${p.last_name}${p.phone ? ` (${p.phone})` : ''}`,
              })),
            ]}
          />
        </Field>
      </div>

      {/* Type, Unit & Sterilization Buffer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="نوع خدمت / علت مراجعه (تنظیم هوشمند مدت)">
          <Select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value)}
            options={APT_TYPES.map((t) => ({
              value: t.value,
              label: `${t.label} (${jalaliToFa(t.defaultDuration)} دقیقه)`,
            }))}
          />
        </Field>
        <div>
          <Field label="یونیت / اتاق درمان">
            <Select
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              options={CLINIC_UNITS}
            />
          </Field>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {loadDentalUnits().map(u => (
              <button
                type="button"
                key={u.id}
                onClick={() => setRoom(u.name)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                  room === u.name ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                {u.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Date, Start Time, Duration & End Time */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="col-span-2">
          <Field label="تاریخ نوبت (شمسی)">
            <JalaliDatePicker value={date} onChange={setDate} />
          </Field>
        </div>
        <Field label="ساعت شروع">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="مدت (دقیقه)">
          <Input
            type="number"
            min={5}
            max={480}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </Field>
      </div>

      {/* Sterilization Buffer & End Time Preview */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-100/90 px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2 text-gray-700 font-bold">
          <Clock size={15} className="text-amber-600" />
          <span>
            بازه نوبت: {time.replace(/\d/g, (d) => jalaliToFa(Number(d)))} تا{' '}
            {(endTime || '—').replace(/\d/g, (d) => jalaliToFa(Number(d)))}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-500 font-semibold">فاصله استریل یونیت:</span>
          {[0, 5, 10, 15].map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setSterilBuffer(b)}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all ${
                sterilBuffer === b
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {b === 0 ? 'بدون فاصله' : `${jalaliToFa(b)} دقیقه`}
            </button>
          ))}
        </div>
      </div>

      {/* Smart Conflict Shield */}
      {primaryConflict ? (
        <div className="rounded-2xl bg-red-50 border-2 border-red-300 p-3.5 space-y-2.5 animate-fade-in">
          <div className="flex items-start gap-2.5 text-red-700">
            <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600" />
            <div className="text-xs leading-relaxed">
              <p className="font-extrabold text-red-800">{primaryConflict.reasonLabel}</p>
              <p className="mt-0.5">
                تداخل با نوبت <b>{conflictName}</b> از ساعت{' '}
                <b>{primaryConflict.appointment.appointment_time.slice(0, 5)}</b> تا{' '}
                <b>
                  {minutesToTime(
                    timeToMinutes(primaryConflict.appointment.appointment_time.slice(0, 5)) +
                      primaryConflict.appointment.duration_min
                  )}
                </b>{' '}
                ({primaryConflict.appointment.room || 'یونیت ۱'}).
              </p>
            </div>
          </div>
          {freeSlots.length > 0 && (
            <button
              type="button"
              onClick={() => setTime(freeSlots[0].time)}
              className="w-full py-2 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95"
            >
              <Sparkles size={14} />
              <span>
                انتخاب خودکار اولین ساعت خالی بدون تداخل ({freeSlots[0].time} - {freeSlots[0].shiftLabel})
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-2.5 flex items-center gap-2 text-emerald-800 text-xs font-bold">
          <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
          <span>این بازه زمانی در «{room}» کاملاً آزاد و بدون تداخل است.</span>
        </div>
      )}

      {/* Smart Suggested Free Slots Radar */}
      {freeSlots.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-gray-800 flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-500" />
              پیشنهاد هوشمند زمان‌های خالی ({room})
            </span>
            <span className="text-[10px] text-gray-400">با ۱ کلیک انتخاب کنید</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {freeSlots.slice(0, 14).map((slot) => {
              const selected = slot.time === time;
              return (
                <button
                  key={slot.time}
                  type="button"
                  onClick={() => setTime(slot.time)}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all flex items-center gap-1 ${
                    selected
                      ? 'bg-amber-500 text-white border-amber-600 shadow-sm scale-105'
                      : 'bg-amber-50/70 text-amber-900 border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  {selected && <CheckCircle2 size={11} />}
                  <span>{slot.time.replace(/\d/g, (d) => jalaliToFa(Number(d)))}</span>
                  <span className="opacity-65 text-[9px]">({slot.shift === 'morning' ? 'صبح' : 'عصر'})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="وضعیت نوبت">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={Object.entries(APPOINTMENT_STATUS).map(([v, c]) => ({ value: v, label: c.label }))}
          />
        </Field>
        <Field label="یادداشت و توضیحات پذیرش">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثلاً نیاز به بی‌حسی ویژه، اورژانسی، همراه بیمار..."
          />
        </Field>
      </div>

      {error && <p className="text-xs text-red-500 px-1 font-bold">{error}</p>}

      <Button onClick={submit} color="#F59E0B" disabled={saving || smartConflicts.length > 0} className="w-full py-3.5">
        {saving ? 'در حال ثبت و همگام‌سازی ابری...' : 'ثبت قطعی نوبت بدون تداخل'}
      </Button>
    </div>
  );
}
