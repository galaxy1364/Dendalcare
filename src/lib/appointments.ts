import type { Appointment } from '@/lib/supabase';

export const APT_TYPES = [
  { value: 'checkup', label: 'معاینه و مشاوره', defaultDuration: 20 },
  { value: 'cleaning', label: 'جرم‌گیری و بروساژ', defaultDuration: 30 },
  { value: 'filling', label: 'ترمیم و پرکردگی', defaultDuration: 45 },
  { value: 'extraction', label: 'کشیدن و جراحی دندان', defaultDuration: 30 },
  { value: 'root_canal', label: 'درمان ریشه (عصب‌کشی)', defaultDuration: 60 },
  { value: 'implant', label: 'جراحی ایمپلنت', defaultDuration: 60 },
  { value: 'orthodontic', label: 'ارتودنسی', defaultDuration: 30 },
  { value: 'cosmetic', label: 'لمینت و زیبایی', defaultDuration: 60 },
  { value: 'emergency', label: 'اورژانس دندانپزشکی', defaultDuration: 25 },
  { value: 'follow_up', label: 'ویزیت مجدد / کنترل', defaultDuration: 15 },
  { value: 'other', label: 'سایر خدمات', defaultDuration: 30 },
];

export const CLINIC_UNITS = [
  { value: 'یونیت ۱ (عمومی)', label: 'یونیت ۱ (عمومی)' },
  { value: 'یونیت ۲ (جراحی و ایمپلنت)', label: 'یونیت ۲ (جراحی و ایمپلنت)' },
  { value: 'یونیت ۳ (ترمیمی و زیبایی)', label: 'یونیت ۳ (ترمیمی و زیبایی)' },
  { value: 'یونیت ۴ (ویژه VIP)', label: 'یونیت ۴ (ویژه VIP)' },
];

export const APPOINTMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: 'در انتظار', color: '#F59E0B', bg: '#FEF3C7' },
  confirmed: { label: 'تاییدشده', color: '#10B981', bg: '#D1FAE5' },
  in_progress: { label: 'در حال انجام', color: '#3B82F6', bg: '#DBEAFE' },
  completed: { label: 'تکمیل', color: '#22C55E', bg: '#DCFCE7' },
  cancelled: { label: 'لغو', color: '#EF4444', bg: '#FEE2E2' },
  no_show: { label: 'غیبت', color: '#9CA3AF', bg: '#F3F4F6' },
};

const INACTIVE_STATUSES = ['cancelled', 'no_show'];

export function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(total: number): string {
  const safe = Math.max(0, total);
  const h = Math.floor(safe / 60) % 24;
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type SmartConflictDetail = {
  appointment: Appointment;
  reasonType: 'exact_overlap' | 'unit_overlap' | 'doctor_overlap' | 'patient_overlap' | 'sterilization_buffer';
  reasonLabel: string;
  overlapMinutes: number;
};

export function findConflict(
  appointments: Appointment[],
  date: string,
  time: string,
  duration: number,
  excludeId: string | null,
  options?: {
    room?: string | null;
    staffId?: string | null;
    patientId?: string | null;
    bufferMin?: number;
  }
): Appointment | null {
  const details = findSmartConflicts(appointments, date, time, duration, excludeId, options);
  return details.length > 0 ? details[0].appointment : null;
}

export function findSmartConflicts(
  appointments: Appointment[],
  date: string,
  time: string,
  duration: number,
  excludeId: string | null,
  options?: {
    room?: string | null;
    staffId?: string | null;
    patientId?: string | null;
    bufferMin?: number;
  }
): SmartConflictDetail[] {
  const start = timeToMinutes(time);
  const end = start + duration;
  const buffer = options?.bufferMin ?? 0;
  const results: SmartConflictDetail[] = [];

  for (const a of appointments) {
    if (a.id === excludeId || a.appointment_date !== date) continue;
    if (INACTIVE_STATUSES.includes(a.status)) continue;

    const aStart = timeToMinutes(a.appointment_time.slice(0, 5));
    const aEnd = aStart + (a.duration_min || 30);

    // Check direct time overlap
    if (start < aEnd && aStart < end) {
      const overlapMinutes = Math.min(end, aEnd) - Math.max(start, aStart);

      if (options?.patientId && a.patient_id === options.patientId) {
        results.push({
          appointment: a,
          reasonType: 'patient_overlap',
          reasonLabel: 'این بیمار در همین ساعت نوبت فعال دیگری دارد',
          overlapMinutes,
        });
        continue;
      }

      if (options?.staffId && a.staff_id && a.staff_id === options.staffId) {
        results.push({
          appointment: a,
          reasonType: 'doctor_overlap',
          reasonLabel: 'تداخل برنامه پزشک معالج در این ساعت',
          overlapMinutes,
        });
        continue;
      }

      const sameRoom = !options?.room || !a.room || a.room.trim() === options.room.trim();
      if (sameRoom) {
        results.push({
          appointment: a,
          reasonType: a.room ? 'unit_overlap' : 'exact_overlap',
          reasonLabel: a.room ? `تداخل زمانی در ${a.room}` : 'تداخل زمانی با نوبت ثبت‌شده در مطب',
          overlapMinutes,
        });
      }
    } else if (buffer > 0) {
      // Check sterilization buffer overlap on the same unit
      const sameRoom = !options?.room || !a.room || a.room.trim() === options.room.trim();
      if (sameRoom && start < aEnd + buffer && aStart - buffer < end) {
        results.push({
          appointment: a,
          reasonType: 'sterilization_buffer',
          reasonLabel: `نیاز به حداقل ${buffer} دقیقه زمان استریل و آماده‌سازی یونیت بین دو بیمار`,
          overlapMinutes: buffer,
        });
      }
    }
  }

  return results;
}

export type SuggestedSlot = {
  time: string;
  endTime: string;
  shift: 'morning' | 'evening';
  shiftLabel: string;
};

/**
 * Computes conflict-free time slots for a given date, duration, and room/doctor.
 */
export function suggestFreeTimeSlots(
  appointments: Appointment[],
  date: string,
  duration: number,
  excludeId: string | null = null,
  options?: {
    room?: string | null;
    staffId?: string | null;
    bufferMin?: number;
  }
): SuggestedSlot[] {
  const safeDuration = Math.max(15, Math.min(duration || 30, 180));
  const step = 15; // 15-minute granularity
  const shifts: { start: number; end: number; shift: 'morning' | 'evening'; label: string }[] = [
    { start: 9 * 60, end: 13 * 60 + 30, shift: 'morning', label: 'شیفت صبح' },
    { start: 16 * 60, end: 21 * 60, shift: 'evening', label: 'شیفت عصر' },
  ];

  const freeSlots: SuggestedSlot[] = [];

  for (const s of shifts) {
    let cursor = s.start;
    while (cursor + safeDuration <= s.end) {
      const candidateTime = minutesToTime(cursor);
      const conflicts = findSmartConflicts(appointments, date, candidateTime, safeDuration, excludeId, options);
      if (conflicts.length === 0) {
        freeSlots.push({
          time: candidateTime,
          endTime: minutesToTime(cursor + safeDuration),
          shift: s.shift,
          shiftLabel: s.label,
        });
        cursor += Math.max(30, safeDuration); // space out suggested slots nicely
      } else {
        // Jump right after the conflicting appointment + buffer
        const blocker = conflicts[0].appointment;
        const blockerEnd =
          timeToMinutes(blocker.appointment_time.slice(0, 5)) +
          (blocker.duration_min || 30) +
          (options?.bufferMin ?? 0);
        cursor = Math.max(cursor + step, Math.ceil(blockerEnd / step) * step);
      }
    }
  }

  return freeSlots;
}
