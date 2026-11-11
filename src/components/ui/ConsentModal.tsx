import { useState } from 'react';
import { Printer, X, FileSignature, CheckCircle2, ShieldAlert } from 'lucide-react';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import type { Patient } from '@/lib/supabase';

type Props = {
  open: boolean;
  onClose: () => void;
  patient: Patient | null;
};

const CONSENT_TYPES = [
  { id: 'implant', title: 'جراحی ایمپلنت و پیوند استخوان' },
  { id: 'endo', title: 'درمان ریشه (عصب‌کشی)' },
  { id: 'surgery', title: 'جراحی دندان عقل و کشیدن' },
  { id: 'prostho', title: 'پروتز ثابت، روکش و لمینت' },
];

export function ConsentModal({ open, onClose, patient }: Props) {
  const [consentType, setConsentType] = useState('implant');

  if (!open || !patient) return null;

  const today = todayGregorian();
  const jalaliToday = toJalaliStr(today);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-6 text-gray-800 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Screen Controls (Hidden during print) */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-100 print:hidden">
          <div className="flex items-center gap-2">
            <FileSignature className="text-emerald-600" size={20} />
            <h3 className="text-base font-bold text-gray-800">برگه رضایت‌نامه آگاهانه درمان</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
            >
              <Printer size={15} />
              چاپ رضایت‌نامه رسمی (A4)
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Type Selector (Screen only) */}
        <div className="flex gap-1.5 p-1 rounded-xl bg-gray-100 mb-4 print:hidden">
          {CONSENT_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => setConsentType(t.id)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${consentType === t.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'}`}
            >
              {t.title}
            </button>
          ))}
        </div>

        {/* Printable Official Consent Sheet */}
        <div className="print-area p-5 border border-gray-300 rounded-2xl bg-white space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b-2 border-emerald-600">
            <div className="text-right">
              <h1 className="text-base font-black text-emerald-800 leading-tight">کلینیک تخصصی دندانپزشکی مینادنتال</h1>
              <p className="text-[11px] text-gray-600 font-semibold mt-0.5">
                فرم رسمی رضایت‌نامه آگاهانه و پذیرش خطرات درمان دندانپزشکی
              </p>
            </div>
            <div className="text-left text-xs text-gray-600 space-y-1">
              <div><span className="text-gray-400">شماره پرونده:</span> <span className="font-bold font-mono">{patient.id.slice(0, 6).toUpperCase()}</span></div>
              <div><span className="text-gray-400">تاریخ:</span> <span className="font-bold">{jalaliToday}</span></div>
            </div>
          </div>

          {/* Patient Details */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-gray-50 rounded-xl text-xs border border-gray-200">
            <div>
              <span className="text-gray-400 block text-[10px]">بیمار (درمان‌جو):</span>
              <span className="font-bold text-gray-800">{patient.first_name} {patient.last_name}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">کد ملی:</span>
              <span className="font-bold font-mono">{patient.national_id || 'ثبت نشده'}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">شماره تماس:</span>
              <span className="font-bold font-mono">{patient.phone || 'ثبت نشده'}</span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px]">نوع درمان انتخابی:</span>
              <span className="font-bold text-emerald-700">
                {CONSENT_TYPES.find(c => c.id === consentType)?.title}
              </span>
            </div>
          </div>

          {/* Legal and Clinical Consent Content */}
          <div className="text-xs text-gray-700 leading-relaxed space-y-2.5 p-3 rounded-xl bg-gray-50/50 border border-gray-200 text-justify">
            <p className="font-bold text-gray-900">
              اینجانب با مشخصات فوق، اعلام می‌دارم که کلیه توضیحات بالینی مربوط به ماهیت درمان، ضرورت انجام، طرح درمان‌های جایگزین و عوارض احتمالی را از دندانپزشک معالج دریافت نموده و با آگاهی کامل رضایت خود را اعلام می‌دارم:
            </p>

            {consentType === 'implant' && (
              <ul className="list-disc pr-5 space-y-1 text-[11px] text-gray-700">
                <li>آگاهی از ریسک عدم جوش خوردن فیکسچر (شکست اسئواینتگریشن) به دلایل سیستمیک یا بافت نامناسب استخوان.</li>
                <li>احتمال نیاز به پیوند استخوان، ممبران یا لیفت سینوس بر اساس مشاهده حین جراحی.</li>
                <li>رعایت کامل بهداشت دهان، مصرف دقیق آنتی‌بیوتیک‌ها و دهان‌شویه و پرهیز کامل از دخانیات و سیگار.</li>
                <li>آگاهی از احتمال بی‌حسی موقت یا احساس گزگز در ناحیه لب و چانه ناشی از مجاورت با عصب دندانی فک پایین.</li>
              </ul>
            )}

            {consentType === 'endo' && (
              <ul className="list-disc pr-5 space-y-1 text-[11px] text-gray-700">
                <li>آگاهی از آناتومی پیچیده ریشه دندان، احتمال شکستگی وسایل باریک داخل کانال به دلیل انحنای شدید ریشه.</li>
                <li>احتمال درد و تورم گذرای پس از درمان ریشه طی ۴۸ تا ۷۲ ساعت اول.</li>
                <li>ضرورت بازسازی تاج و روکش به موقع دندان عصب‌کشی‌شده جهت پیشگیری از شکستگی شکست ناپذیر دندان.</li>
              </ul>
            )}

            {consentType === 'surgery' && (
              <ul className="list-disc pr-5 space-y-1 text-[11px] text-gray-700">
                <li>احتمال خونریزی، درد، تورم گونه، کبودی پوست و محدودیت در باز کردن دهان (تریسموس) طی چند روز آینده.</li>
                <li>احتمال وقوع درای ساکت (حفره خشک) در صورت مکیدن لخته یا مصرف دخانیات طی ۴۸ ساعت اول.</li>
                <li>رعایت نکات استراحت و عدم استفاده از نی و غذاهای داغ در شب اول پس از جراحی.</li>
              </ul>
            )}

            {consentType === 'prostho' && (
              <ul className="list-disc pr-5 space-y-1 text-[11px] text-gray-700">
                <li>آگاهی از مراحل تراش، قالب‌گیری، امتحان فریم و تحویل نهایی پروتز و لزوم مراجعات منظم جهت تنظیم اکلوژن.</li>
                <li>تایید نهایی فرم و رنگ دندان‌ها (شید ویتا) قبل از سمان و چسب دائم توسط بیمار.</li>
              </ul>
            )}

            <p className="text-[11px] text-gray-600 font-semibold pt-1 border-t border-gray-200">
              اینجانب صحت سوابق پزشکی، دارویی (وارفارین، آسپرین، بیس‌فسفونات‌ها) و حساسیت‌های دارویی خود را تایید نموده و تعهد می‌نمایم کلیه دستورات بهداشتی و دارویی را رعایت فرمایم.
            </p>
          </div>

          {/* Signatures and Stamp */}
          <div className="grid grid-cols-2 gap-8 pt-8 border-t-2 border-gray-200 text-center text-xs">
            <div className="p-3 border border-gray-200 rounded-xl space-y-10">
              <span className="font-bold text-gray-700 block">نام، امضا و اثر انگشت بیمار یا ولی قانونی</span>
              <div className="text-[10px] text-gray-400">تاریخ و محل اثر انگشت</div>
            </div>
            <div className="p-3 border border-gray-200 rounded-xl space-y-10">
              <span className="font-bold text-gray-700 block">مهر و امضای دندانپزشک معالج</span>
              <div className="text-[10px] text-gray-400">نظام پزشکی: ............................</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
