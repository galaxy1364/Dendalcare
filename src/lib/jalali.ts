export type JDate = { jy: number; jm: number; jd: number };

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export const GREGORIAN_MONTHS_FA = [
  'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
  'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر',
];

export const HIJRI_MONTHS_FA = [
  'محرم', 'صفر', 'ربیع‌الاول', 'ربیع‌الثانی', 'جمادی‌الاول', 'جمادی‌الثانی',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذی‌القعده', 'ذی‌الحجه',
];

export const JALALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const JALALI_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const faDayNames = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
export { faDayNames };

export type CalendarOccasion = {
  title: string;
  isHoliday: boolean;
  category: 'national' | 'dental' | 'religious' | 'global';
};

// Perpetual Iranian Solar Occasions & Official Holidays + Dental Occasions
export const JALALI_FIXED_OCCASIONS: Record<string, CalendarOccasion[]> = {
  '1-1': [{ title: 'جشن نوروز و آغاز سال نو خورشیدی', isHoliday: true, category: 'national' }],
  '1-2': [{ title: 'عید نوروز', isHoliday: true, category: 'national' }],
  '1-3': [{ title: 'عید نوروز', isHoliday: true, category: 'national' }],
  '1-4': [{ title: 'عید نوروز', isHoliday: true, category: 'national' }],
  '1-12': [{ title: 'روز جمهوری اسلامی', isHoliday: true, category: 'national' }],
  '1-13': [{ title: 'جشن سیزده‌به‌در (روز طبیعت)', isHoliday: true, category: 'national' }],
  '1-18': [{ title: 'روز جهانی سلامت', isHoliday: false, category: 'dental' }],
  '1-23': [{ title: 'روز دندانپزشک ایران 🦷', isHoliday: false, category: 'dental' }],
  '2-1': [{ title: 'روز بزرگداشت سعدی', isHoliday: false, category: 'national' }],
  '2-12': [{ title: 'روز معلم', isHoliday: false, category: 'national' }],
  '2-15': [{ title: 'روز شیراز و بزرگداشت شیخ صدوق', isHoliday: false, category: 'national' }],
  '2-25': [{ title: 'روز بزرگداشت فردوسی و پاسداشت زبان فارسی', isHoliday: false, category: 'national' }],
  '3-14': [{ title: 'رحلت امام خمینی', isHoliday: true, category: 'national' }],
  '3-15': [{ title: 'قیام ۱۵ خرداد', isHoliday: true, category: 'national' }],
  '4-1': [{ title: 'جشن آب‌پاشونک / آغاز تابستان', isHoliday: false, category: 'national' }],
  '5-30': [{ title: 'روز پزشک (بزرگداشت ابن‌سینا) 🩺', isHoliday: false, category: 'dental' }],
  '6-1': [{ title: 'روز بزرگداشت بوعلی سینا و روز پزشک', isHoliday: false, category: 'dental' }],
  '6-5': [{ title: 'روز داروساز (بزرگداشت محمد بن زکریای رازی)', isHoliday: false, category: 'dental' }],
  '6-27': [{ title: 'روز شعر و ادب فارسی (شهریار)', isHoliday: false, category: 'national' }],
  '7-1': [{ title: 'آغاز پاییز و بازگشایی مدارس', isHoliday: false, category: 'national' }],
  '7-20': [{ title: 'روز بزرگداشت حافظ', isHoliday: false, category: 'national' }],
  '8-7': [{ title: 'روز کوروش بزرگ', isHoliday: false, category: 'national' }],
  '9-16': [{ title: 'روز دانشجو', isHoliday: false, category: 'national' }],
  '9-30': [{ title: 'جشن شب یلدا (شب چله)', isHoliday: false, category: 'national' }],
  '11-22': [{ title: 'پیروزی انقلاب اسلامی', isHoliday: true, category: 'national' }],
  '12-5': [{ title: 'روز مهندس (خواجه نصیرالدین طوسی)', isHoliday: false, category: 'national' }],
  '12-15': [{ title: 'روز درختکاری', isHoliday: false, category: 'national' }],
  '12-29': [{ title: 'روز ملی شدن صنعت نفت ایران', isHoliday: true, category: 'national' }],
};

function div(a: number, b: number) { return Math.floor(a / b); }
function mod(a: number, b: number) { return a - Math.floor(a / b) * b; }

export function gregorianToJalali(gy: number, gm: number, gd: number): JDate {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days = mod(days, 12053);
  jy += 4 * div(days, 1461);
  days = mod(days, 1461);
  if (days > 365) { jy += div(days - 1, 365); days = mod(days - 1, 365); }
  if (days < 186) return { jy, jm: 1 + div(days, 31), jd: 1 + mod(days, 31) };
  return { jy, jm: 7 + div(days - 186, 30), jd: 1 + mod(days - 186, 30) };
}

const DAY_MS = 86400000;

function jalaliKey(j: JDate): number {
  return j.jy * 10000 + j.jm * 100 + j.jd;
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  const target = jalaliKey({ jy, jm, jd });
  let ms = Date.UTC(jy + 621, 2, 21) + Math.round((jm - 1) * 30.6 + jd - 1) * DAY_MS;
  for (let i = 0; i < 80; i++) {
    const d = new Date(ms);
    const gy = d.getUTCFullYear();
    const gm = d.getUTCMonth() + 1;
    const gd = d.getUTCDate();
    const key = jalaliKey(gregorianToJalali(gy, gm, gd));
    if (key === target) return [gy, gm, gd];
    ms += key < target ? DAY_MS : -DAY_MS;
  }
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export function isJalaliLeap(jy: number): boolean {
  const [y1, m1, d1] = jalaliToGregorian(jy, 12, 29);
  const [y2, m2, d2] = jalaliToGregorian(jy + 1, 1, 1);
  const diffDays = (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS;
  return diffDays === 2;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

export function dateStrToJalali(dateStr: string): JDate {
  if (!dateStr) return { jy: 0, jm: 0, jd: 0 };
  const d = new Date(dateStr + 'T00:00:00');
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function toJalaliStr(dateStr: string): string {
  if (!dateStr) return '';
  const j = dateStrToJalali(dateStr);
  return `${j.jy.toLocaleString('fa-IR')}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
}

export function toJalaliShortStr(dateStr: string): string {
  if (!dateStr) return '';
  const j = dateStrToJalali(dateStr);
  return `${String(j.jd).padStart(2, '0')} ${JALALI_MONTHS[j.jm - 1]}`;
}

export function toJalaliFullLabel(dateStr: string): string {
  if (!dateStr) return '';
  const j = dateStrToJalali(dateStr);
  const wd = weekdayName(dateStr);
  return `${wd}، ${j.jd.toLocaleString('fa-IR')} ${JALALI_MONTHS[j.jm - 1]} ${j.jy.toLocaleString('fa-IR')}`;
}

export function toJalaliMonthYear(dateStr: string): string {
  if (!dateStr) return '';
  const j = dateStrToJalali(dateStr);
  return `${JALALI_MONTHS[j.jm - 1]} ${j.jy.toLocaleString('fa-IR')}`;
}

export function jalaliToGregorianStr(jy: number, jm: number, jd: number): string {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

export function weekdayName(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return faDayNames[d.getDay()];
}

export function jalaliToFa(n: number): string {
  return n.toLocaleString('fa-IR');
}

// Hijri Lunar Conversion (Kuwaiti / Tabular Islamic Calendar)
export function gregorianToHijri(gy: number, gm: number, gd: number): { hy: number; hm: number; hd: number } {
  try {
    const d = new Date(Date.UTC(gy, gm - 1, gd));
    const fmt = new Intl.DateTimeFormat('en-TN-u-ca-islamic-umalqura', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const parts = fmt.formatToParts(d);
    const hy = Number(parts.find(p => p.type === 'year')?.value || 1446);
    const hm = Number(parts.find(p => p.type === 'month')?.value || 1);
    const hd = Number(parts.find(p => p.type === 'day')?.value || 1);
    if (hy > 1300 && hm >= 1 && hm <= 12) {
      return { hy, hm, hd };
    }
  } catch {
    // fallback algorithm below
  }
  const jd =
    div(1461 * (gy + 4800 + div(gm - 14, 12)), 4) +
    div(367 * (gm - 2 - 12 * div(gm - 14, 12)), 12) -
    div(3 * div(gy + 4900 + div(gm - 14, 12), 100), 4) +
    gd - 32075;
  let l = jd - 1948440 + 10632;
  const n = div(l - 1, 10631);
  l = l - 10631 * n + 354;
  const j = div(10985 - l, 5316) * div(50 * l, 17719) + div(l, 5670) * div(43 * l, 15238);
  l = l - div(30 - j, 15) * div(17719 * j, 50) - div(j, 16) * div(15238 * j, 43) + 29;
  const hm = div(24 * l, 709);
  const hd = l - div(709 * hm, 24);
  const hy = 30 * n + j - 30;
  return { hy, hm, hd };
}

export function toHijriStr(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const h = gregorianToHijri(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${h.hd.toLocaleString('fa-IR')} ${HIJRI_MONTHS_FA[h.hm - 1] || ''} ${h.hy.toLocaleString('fa-IR')}`;
}

export function toGregorianFaStr(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${GREGORIAN_MONTHS_FA[d.getMonth()]} ${d.getFullYear()}`;
}

export function getJalaliDayOccasions(jy: number, jm: number, jd: number, weekdayIdx?: number): {
  occasions: CalendarOccasion[];
  isOfficialHoliday: boolean;
} {
  const key = `${jm}-${jd}`;
  const list = [...(JALALI_FIXED_OCCASIONS[key] || [])];
  // Check Hijri major occasions dynamically so they stay accurate forever across any year!
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const h = gregorianToHijri(gy, gm, gd);
  const hKey = `${h.hm}-${h.hd}`;
  const hijriMap: Record<string, CalendarOccasion> = {
    '1-9': { title: 'تاسوعای حسینی', isHoliday: true, category: 'religious' },
    '1-10': { title: 'عاشورای حسینی', isHoliday: true, category: 'religious' },
    '2-20': { title: 'اربعین حسینی', isHoliday: true, category: 'religious' },
    '2-28': { title: 'رحلت پیامبر اکرم و شهادت امام حسن مجتبی', isHoliday: true, category: 'religious' },
    '3-17': { title: 'میلاد پیامبر اکرم و امام جعفر صادق', isHoliday: true, category: 'religious' },
    '6-3': { title: 'شهادت حضرت فاطمه زهرا', isHoliday: true, category: 'religious' },
    '7-13': { title: 'ولادت امام علی (روز پدر)', isHoliday: true, category: 'religious' },
    '7-27': { title: 'مبعث پیامبر اکرم', isHoliday: true, category: 'religious' },
    '8-15': { title: 'نیمه شعبان (ولادت حضرت قائم)', isHoliday: true, category: 'religious' },
    '9-21': { title: 'شهادت حضرت علی', isHoliday: true, category: 'religious' },
    '10-1': { title: 'عید سعید فطر', isHoliday: true, category: 'religious' },
    '10-2': { title: 'تعطیل به مناسبت عید سعید فطر', isHoliday: true, category: 'religious' },
    '10-25': { title: 'شهادت امام جعفر صادق', isHoliday: true, category: 'religious' },
    '12-10': { title: 'عید سعید قربان', isHoliday: true, category: 'religious' },
    '12-18': { title: 'عید سعید غدیر خم', isHoliday: true, category: 'religious' },
  };
  if (hijriMap[hKey]) {
    list.push(hijriMap[hKey]);
  }
  const isFriday = weekdayIdx === 6;
  const isOfficialHoliday = isFriday || list.some(o => o.isHoliday);
  return { occasions: list, isOfficialHoliday };
}

export function getMonthMatrix(jy: number, jm: number): { jd: number | null; gregorian: string | null; weekdayIdx: number }[][] {
  const monthLen = jalaliMonthLength(jy, jm);
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, 1);
  const firstDay = new Date(gy, gm - 1, gd);
  let firstWeekday = firstDay.getDay(); // 0=Sun
  firstWeekday = (firstWeekday + 1) % 7; // shift so Sat=0

  const weeks: { jd: number | null; gregorian: string | null; weekdayIdx: number }[][] = [];
  let day = 1;
  for (let w = 0; w < 6; w++) {
    const row: { jd: number | null; gregorian: string | null; weekdayIdx: number }[] = [];
    for (let d = 0; d < 7; d++) {
      if (w === 0 && d < firstWeekday) {
        row.push({ jd: null, gregorian: null, weekdayIdx: d });
      } else if (day > monthLen) {
        row.push({ jd: null, gregorian: null, weekdayIdx: d });
      } else {
        const [gy2, gm2, gd2] = jalaliToGregorian(jy, jm, day);
        row.push({
          jd: day,
          gregorian: `${gy2}-${String(gm2).padStart(2, '0')}-${String(gd2).padStart(2, '0')}`,
          weekdayIdx: d,
        });
        day++;
      }
    }
    weeks.push(row);
    if (day > monthLen && w >= 3) break;
  }
  return weeks;
}

export function getJalaliWeekDays(centerDateStr: string): {
  gregorian: string;
  jDate: JDate;
  weekdayIdx: number;
  weekdayLabel: string;
}[] {
  const d = new Date(centerDateStr + 'T00:00:00');
  const satOffset = (d.getDay() + 1) % 7; // 0 for Saturday
  const satDate = new Date(d);
  satDate.setDate(d.getDate() - satOffset);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(satDate);
    cur.setDate(satDate.getDate() + i);
    const greg = formatGregorianDate(cur);
    days.push({
      gregorian: greg,
      jDate: dateStrToJalali(greg),
      weekdayIdx: i,
      weekdayLabel: JALALI_WEEKDAYS[i],
    });
  }
  return days;
}

export function formatGregorianDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayGregorian(): string {
  return formatGregorianDate(new Date());
}

export function todayJalali(): JDate {
  return dateStrToJalali(todayGregorian());
}

export function shiftGregorianDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatGregorianDate(d);
}
