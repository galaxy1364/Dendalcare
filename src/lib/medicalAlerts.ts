export type MedicalAlert = {
  keyword: string;
  category: 'anticoagulant' | 'bisphosphonate' | 'allergy' | 'cardiac' | 'systemic';
  severity: 'high' | 'critical';
  titleFa: string;
  recommendationFa: string;
};

const HIGH_RISK_TRIGGERS: { words: string[]; alert: Omit<MedicalAlert, 'keyword'> }[] = [
  {
    words: ['وارفارین', 'آسپرین', 'پلاویکس', 'هپارین', 'کلوپیدوگرل', 'خونریزی', 'پلاکت', 'آسپیرین'],
    alert: {
      category: 'anticoagulant',
      severity: 'critical',
      titleFa: 'رقیق‌کننده خون (خطر خونریزی حین جراحی)',
      recommendationFa: 'پیش از جراحی یا کشیدن دندان، آزمایش INR و مشورت با پزشک معالج الزامی است.',
    },
  },
  {
    words: ['آلندرونات', 'فوزامکس', 'زومتا', 'بیس‌فسفونات', 'پوکی استخوان', 'استئوپوروز'],
    alert: {
      category: 'bisphosphonate',
      severity: 'critical',
      titleFa: 'مصرف بیس‌فسفونات (ریسک استئونکروز فک)',
      recommendationFa: 'جراحی ایمپلنت نیازمند احتیاط ویژه به دلیل خطر آسیب استخوانی است.',
    },
  },
  {
    words: ['پنی‌سیلین', 'لیدوکائین', 'آدرنالین', 'حساسیت دارویی', 'شوک', 'آنافیلاکسی'],
    alert: {
      category: 'allergy',
      severity: 'critical',
      titleFa: 'آلرژی به دارو یا بی‌حسی',
      recommendationFa: 'از داروی بی‌حسی جایگزین (فاقد اپی‌نفرین یا تست حساسیت) استفاده شود.',
    },
  },
  {
    words: ['قلب', 'فشار خون', 'استنت', 'بای‌پس', 'دیابت', 'انسولین', 'هپاتیت', 'کلیه'],
    alert: {
      category: 'cardiac',
      severity: 'high',
      titleFa: 'بیماری زمینه‌ای مهم (قلب/دیابت/فشارخون)',
      recommendationFa: 'کنترل فشار و قند قبل از درمان و پایش سطح استرس بیمار در یونیت.',
    },
  },
];

export function detectMedicalAlerts(text: string | null | undefined): MedicalAlert[] {
  if (!text) return [];
  const normalized = text.toLowerCase();
  const found: MedicalAlert[] = [];

  for (const trigger of HIGH_RISK_TRIGGERS) {
    for (const w of trigger.words) {
      if (normalized.includes(w)) {
        found.push({
          keyword: w,
          ...trigger.alert,
        });
        break;
      }
    }
  }

  return found;
}
