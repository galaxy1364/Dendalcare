import { useRef } from 'react';
import { Printer, X, FileText, CheckCircle2 } from 'lucide-react';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import type { Patient, Treatment } from '@/lib/supabase';

type Props = {
  open: boolean;
  onClose: () => void;
  patient: Patient | null;
  treatments: Treatment[];
};

export function PrintInvoiceModal({ open, onClose, patient, treatments }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!open || !patient) return null;

  const today = todayGregorian();
  const jalaliToday = toJalaliStr(today);

  const totalCost = treatments.reduce((s, t) => s + (Number(t.total_cost) || 0), 0);
  const totalPaid = treatments.reduce((s, t) => s + (Number(t.paid_amount) || 0), 0);
  const remaining = totalCost - totalPaid;

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
            <FileText className="text-blue-600" size={20} />
            <h3 className="text-base font-bold text-gray-800">پیش‌نمایش صورتحساب و فاکتور بیمه</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 active:scale-95"
            >
              <Printer size={15} />
              چاپ فاکتور (A4 / A5)
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Printable Invoice Sheet */}
        <div ref={printRef} className="print-area p-4 border border-gray-200 rounded-2xl bg-white">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b-2 border-blue-600 mb-4">
            <div className="text-right">
              <h1 className="text-lg font-black text-blue-700 leading-tight">کلینیک تخصصی دندانپزشکی مینادنتال</h1>
              <p className="text-[11px] text-gray-500 mt-0.5">صورتحساب خدمات درمانی و ارائه به بیمه</p>
            </div>
            <div className="text-left text-xs text-gray-600 space-y-1">
              <div><span className="text-gray-400">شماره فاکتور:</span> <span className="font-bold font-mono">INV-{patient.id.slice(0, 6).toUpperCase()}</span></div>
              <div><span className="text-gray-400">تاریخ صدور:</span> <span className="font-bold">{jalaliToday}</span></div>
            </div>
          </div>

          {/* Patient Details */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-gray-50 rounded-xl mb-4 text-xs">
            <div>
              <span className="text-gray-400 block text-[10px]">نام و نام خانوادگی:</span>
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
              <span className="text-gray-400 block text-[10px]">بیمه طرف قرارداد:</span>
              <span className="font-bold">{patient.insurance_provider || 'آزاد'}</span>
            </div>
          </div>

          {/* Treatment items table */}
          <table className="w-full text-right text-xs mb-4 border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100 text-gray-600">
                <th className="py-2 px-3">ردیف</th>
                <th className="py-2 px-3">شرح درمان / خدمت دندانپزشکی</th>
                <th className="py-2 px-3">شماره دندان</th>
                <th className="py-2 px-3 text-left">مبلغ (تومان)</th>
              </tr>
            </thead>
            <tbody>
              {treatments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-gray-400">موردی برای نمایش وجود ندارد</td>
                </tr>
              ) : (
                treatments.map((t, idx) => (
                  <tr key={t.id} className="border-b border-gray-100">
                    <td className="py-2.5 px-3 font-mono text-gray-400">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-gray-800">{t.diagnosis || t.treatment_plan || 'خدمات عمومی دندانپزشکی'}</td>
                    <td className="py-2.5 px-3 font-mono">{t.tooth_numbers || '-'}</td>
                    <td className="py-2.5 px-3 text-left font-bold font-mono">{Number(t.total_cost || 0).toLocaleString('fa-IR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Totals Summary */}
          <div className="flex justify-end mb-6">
            <div className="w-64 space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>جمع کل خدمات:</span>
                <span className="font-bold font-mono">{totalCost.toLocaleString('fa-IR')} تومان</span>
              </div>
              <div className="flex justify-between text-emerald-600">
                <span>مبلغ پرداخت‌شده:</span>
                <span className="font-bold font-mono">{totalPaid.toLocaleString('fa-IR')} تومان</span>
              </div>
              <div className="flex justify-between text-sm font-black text-gray-900 pt-1.5 border-t border-gray-200">
                <span>مانده بدهی:</span>
                <span className="font-mono text-blue-700">{remaining.toLocaleString('fa-IR')} تومان</span>
              </div>
            </div>
          </div>

          {/* Stamp & Signature Footer */}
          <div className="grid grid-cols-2 gap-6 pt-6 border-t border-dashed border-gray-200 text-center text-xs text-gray-500">
            <div>
              <p className="mb-8">امضا و تایید بیمار</p>
              <div className="w-28 h-px bg-gray-300 mx-auto" />
            </div>
            <div>
              <p className="mb-8">مهر و امضای پزشک معالج</p>
              <div className="w-28 h-px bg-gray-300 mx-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
