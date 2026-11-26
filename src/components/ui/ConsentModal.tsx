import { useState } from 'react';
import { Printer, X, FileSignature, CheckCircle2, ShieldAlert, Lock, Ban } from 'lucide-react';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import type { Patient } from '@/lib/supabase';
import {
  getPatientConsentRecords,
  recordPrintedUnsignedConsentCommand,
  signPatientConsentCommand,
  withdrawPatientConsentCommand,
  type ConsentSignatureMethod,
} from '@/features/clinical-record/clinicalRecordService';
import { getRuntimeServerVerifiedRole } from '@/services/authentication/authService';

type Props = {
  open: boolean;
  onClose: () => void;
  patient: Patient | null;
  actorRole?: string;
  actorName?: string;
};

const CONSENT_TYPES: ReadonlyArray<{
  id: 'implant' | 'endo' | 'surgery' | 'prostho';
  title: string;
}> = [
  { id: 'implant', title: 'جراحی ایمپلنت و پیوند استخوان' },
  { id: 'endo', title: 'درمان ریشه (عصب‌کشی)' },
  { id: 'surgery', title: 'جراحی دندان عقل و کشیدن' },
  { id: 'prostho', title: 'پروتز ثابت، روکش و لمینت' },
];

export function ConsentModal({ open, onClose, patient, actorRole, actorName }: Props) {
  const [consentType, setConsentType] = useState<'implant' | 'endo' | 'surgery' | 'prostho'>('implant');
  const [fdiTeethScope, setFdiTeethScope] = useState('');
  const [signerFullName, setSignerFullName] = useState('');
  const [signerRelationship, setSignerRelationship] = useState<'self' | 'legal_guardian'>('self');
  const [witnessFullName, setWitnessFullName] = useState('');
  const [attendingClinicianName, setAttendingClinicianName] = useState(actorName || 'دکتر مهدی امیری');
  const [signatureMethod, setSignatureMethod] = useState<ConsentSignatureMethod>('in_person_witnessed_electronic');
  const [risksDiscussed, setRisksDiscussed] = useState(false);
  const [alternativesDiscussed, setAlternativesDiscussed] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [, setTick] = useState(0);

  if (!open || !patient) return null;

  const effectiveRole = actorRole || getRuntimeServerVerifiedRole() || 'dentist';
  const effectiveActor = actorName || 'دکتر مهدی امیری';
  const today = todayGregorian();
  const jalaliToday = toJalaliStr(today);
  const selectedTitle = CONSENT_TYPES.find((c) => c.id === consentType)?.title || '';
  const consentHistory = getPatientConsentRecords(patient.id);

  const handlePrintUnsigned = () => {
    const res = recordPrintedUnsignedConsentCommand({
      patientId: patient.id,
      activeContextPatientId: patient.id,
      consentType,
      procedureScope: selectedTitle,
      fdiTeethScope,
      actorName: effectiveActor,
      actorRole: effectiveRole,
    });
    if (!res.ok) {
      setStatusMessage({ type: 'error', text: res.errorMessageFa || 'ثبت وضعیت چاپ انجام نشد.' });
      return;
    }
    setTick((t) => t + 1);
    setStatusMessage({
      type: 'info',
      text: 'برگه کاغذی با وضعیت «چاپ‌شده — بدون امضای ثبت‌شده (Printed Unsigned)» در پرونده ثبت شد. تا زمان ثبت مستند امضاشده، رضایت‌نامه معتبر تلقی نمی‌شود.',
    });
    window.print();
  };

  const handleSignAttributableConsent = () => {
    const res = signPatientConsentCommand({
      patientId: patient.id,
      activeContextPatientId: patient.id,
      consentType,
      procedureScope: selectedTitle,
      fdiTeethScope,
      risksDiscussed,
      alternativesDiscussed,
      signatureMethod,
      signerFullName: signerFullName || `${patient.first_name} ${patient.last_name}`.trim(),
      signerRelationship,
      witnessFullName,
      attendingClinicianName,
      actorName: effectiveActor,
      actorRole: effectiveRole,
    });
    if (!res.ok) {
      setStatusMessage({ type: 'error', text: res.errorMessageFa || 'ثبت رضایت‌نامه امضاشده انجام نشد.' });
      return;
    }
    setTick((t) => t + 1);
    setStatusMessage({
      type: 'success',
      text: `رضایت‌نامه نسخه ${res.record?.templateVersion} با مستند امضای «${res.record?.signerFullName}» ثبت و قفل شد (غیرقابل ویرایش درجا).`,
    });
  };

  const handleWithdraw = (consentId: string) => {
    const res = withdrawPatientConsentCommand({
      patientId: patient.id,
      consentId,
      reason: withdrawReason || 'لغو رضایت‌نامه به درخواست بیمار',
      actorRole: effectiveRole,
    });
    if (!res.ok) {
      setStatusMessage({ type: 'error', text: res.errorMessageFa || 'لغو رضایت‌نامه انجام نشد.' });
      return;
    }
    setWithdrawReason('');
    setTick((t) => t + 1);
    setStatusMessage({ type: 'info', text: 'رضایت‌نامه با ثبت علت و زمان در تاریخچه ابطال شد.' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-5 text-gray-800 animate-scale-in space-y-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="consent_modal_v15"
      >
        {/* Screen Controls (Hidden during print) */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 print:hidden">
          <div className="flex items-center gap-2">
            <FileSignature className="text-emerald-600" size={20} />
            <div>
              <h3 className="text-sm font-black text-gray-800">
                مدیریت و ثبت رضایت‌نامه آگاهانه درمان (نسخه v15.1-fa)
              </h3>
              <p className="text-[10.5px] text-gray-500">
                تفکیک 엄격 برگه چاپ‌شده بدون امضا از رضایت‌نامه امضاشده معتبر و غیرقابل ویرایش درجا
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintUnsigned}
              data-testid="consent_print_unsigned_btn"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-all shadow-sm"
            >
              <Printer size={14} />
              چاپ فرم خام (بدون امضا)
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن رضایت‌نامه"
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            className={`p-3 rounded-2xl text-xs font-bold border print:hidden ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : statusMessage.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
            data-testid="consent_status_banner"
          >
            {statusMessage.text}
          </div>
        )}

        {/* Type Selector (Screen only) */}
        <div className="flex gap-1.5 p-1 rounded-xl bg-gray-100 print:hidden">
          {CONSENT_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setConsentType(t.id)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                consentType === t.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>

        {/* Attributable Evidence & Signature Verification Form (Screen only — CL-03) */}
        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 print:hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <ShieldAlert size={15} className="text-emerald-600" />
              ثبت مستند امضای رضایت‌نامه آگاهانه (الزامی جهت اعتبار بالینی)
            </span>
            <span className="text-[10px] font-mono text-slate-500">Template: v15.1-fa</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                نام کامل امضاکننده (بیمار/ولی)
              </label>
              <input
                type="text"
                value={signerFullName}
                onChange={(e) => setSignerFullName(e.target.value)}
                placeholder={`${patient.first_name} ${patient.last_name}`}
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                نسبت امضاکننده
              </label>
              <select
                value={signerRelationship}
                onChange={(e) => setSignerRelationship(e.target.value as 'self' | 'legal_guardian')}
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="self">خود بیمار (درمان‌جو)</option>
                <option value="legal_guardian">ولی یا قیم قانونی</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                دندان‌های FDI مشمول رضایت‌نامه
              </label>
              <input
                type="text"
                value={fdiTeethScope}
                onChange={(e) => setFdiTeethScope(e.target.value)}
                placeholder="مثلاً FDI #16, #17"
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                روش اخذ امضا
              </label>
              <select
                value={signatureMethod}
                onChange={(e) => setSignatureMethod(e.target.value as ConsentSignatureMethod)}
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="in_person_witnessed_electronic">امضای حضوری با تأیید شاهد و پزشک</option>
                <option value="scanned_signed_attachment">اسکن برگه فیزیکی امضاشده و اثر انگشت</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                نام شاهد حضوری
              </label>
              <input
                type="text"
                value={witnessFullName}
                onChange={(e) => setWitnessFullName(e.target.value)}
                placeholder="نام شاهد..."
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                دندانپزشک معالج
              </label>
              <input
                type="text"
                value={attendingClinicianName}
                onChange={(e) => setAttendingClinicianName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5 pt-1 text-[11px]">
            <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={risksDiscussed}
                onChange={(e) => setRisksDiscussed(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>عوارض و خطرات احتمالی درمان به‌طور کامل و شفاف برای بیمار/ولی توضیح داده شد.</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={alternativesDiscussed}
                onChange={(e) => setAlternativesDiscussed(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>روش‌های درمانی جایگزین و پیامدهای عدم درمان به بیمار توضیح داده شد.</span>
            </label>
          </div>

          <button
            type="button"
            onClick={handleSignAttributableConsent}
            data-testid="consent_record_signed_btn"
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm transition-all"
          >
            <CheckCircle2 size={15} />
            ثبت نهایی و قفل رضایت‌نامه امضاشده (نیازمند تأیید دندانپزشک و اتصال آنلاین)
          </button>
        </div>

        {/* Persisted Consent Audit Ledger for Patient */}
        {consentHistory.length > 0 && (
          <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-2 print:hidden">
            <p className="text-xs font-extrabold text-slate-700">
              سابقه رضایت‌نامه‌های ثبت‌شده این بیمار ({consentHistory.length.toLocaleString('fa-IR')} مورد):
            </p>
            {consentHistory.map((rec) => (
              <div
                key={rec.id}
                className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-xl border border-gray-200 text-[11px]"
              >
                <div>
                  <span className="font-black text-slate-800">{rec.procedureScope}</span>
                  {rec.fdiTeethScope && (
                    <span className="text-emerald-700 font-bold mr-1.5">• دندان: {rec.fdiTeethScope}</span>
                  )}
                  <span className="text-gray-500 mr-1.5">• نسخه {rec.templateVersion}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {rec.status === 'printed_unsigned' && (
                    <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 font-extrabold">
                      چاپ‌شده — بدون امضا (نامعتبر برای شروع جراحی)
                    </span>
                  )}
                  {rec.status === 'signed' && (
                    <>
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 font-extrabold flex items-center gap-1">
                        <Lock size={11} /> امضاشده توسط {rec.signerFullName} (قفل‌شده)
                      </span>
                      <button
                        type="button"
                        onClick={() => handleWithdraw(rec.id)}
                        className="px-2 py-0.5 rounded-lg bg-red-50 text-red-700 border border-red-200 font-bold flex items-center gap-0.5"
                      >
                        <Ban size={10} /> ابطال/لغو
                      </button>
                    </>
                  )}
                  {rec.status === 'withdrawn' && (
                    <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-800 font-extrabold">
                      لغوشده ({rec.withdrawalReason})
                    </span>
                  )}
                  {rec.status === 'superseded_by_plan_change' && (
                    <span className="px-2 py-0.5 rounded-lg bg-purple-100 text-purple-800 font-extrabold">
                      منقضی در اثر تغییر طرح درمان
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Printable Official Consent Sheet */}
        <div className="print-area p-5 border border-gray-300 rounded-2xl bg-white space-y-4">
          <div className="flex items-center justify-between pb-3 border-b-2 border-emerald-600">
            <div className="text-right">
              <h1 className="text-base font-black text-emerald-800 leading-tight">
                کلینیک تخصصی دندانپزشکی مینادنتال
              </h1>
              <p className="text-[11px] text-gray-600 font-semibold mt-0.5">
                فرم رسمی رضایت‌نامه آگاهانه و پذیرش خطرات درمان دندانپزشکی (نسخه v15.1-fa)
              </p>
            </div>
            <div className="text-left text-xs text-gray-600 space-y-1">
              <div>
                <span className="text-gray-400">شناسه پرونده:</span>{' '}
                <span className="font-bold font-mono">{patient.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div>
                <span className="text-gray-400">تاریخ:</span>{' '}
                <span className="font-bold">{jalaliToday}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-gray-50 rounded-xl text-xs border border-gray-200">
            <div>
              <span className="text-gray-400 block text-[10px]">بیمار (درمان‌جو):</span>
              <span className="font-bold text-gray-800">
                {patient.first_name} {patient.last_name}
              </span>
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
              <span className="text-gray-400 block text-[10px]">محدوده درمان و دندان:</span>
              <span className="font-bold text-emerald-700">
                {selectedTitle} {fdiTeethScope ? `(${fdiTeethScope})` : ''}
              </span>
            </div>
          </div>

          <div className="text-xs text-gray-700 leading-relaxed space-y-2 p-3 rounded-xl bg-gray-50/50 border border-gray-200 text-justify">
            <p className="font-bold text-gray-900">
              اینجانب با مشخصات فوق، اعلام می‌دارم که کلیه توضیحات بالینی مربوط به ماهیت درمان، ضرورت انجام، طرح درمان‌های جایگزین و عوارض احتمالی را از دندانپزشک معالج دریافت نموده و با آگاهی کامل رضایت خود را اعلام می‌دارم.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 pt-6 border-t-2 border-gray-200 text-center text-xs">
            <div className="p-3 border border-gray-200 rounded-xl space-y-8">
              <span className="font-bold text-gray-700 block">
                نام، امضا و اثر انگشت بیمار یا ولی قانونی
              </span>
              <div className="text-[10px] text-gray-400">تاریخ و محل اثر انگشت</div>
            </div>
            <div className="p-3 border border-gray-200 rounded-xl space-y-8">
              <span className="font-bold text-gray-700 block">مهر و امضای دندانپزشک معالج</span>
              <div className="text-[10px] text-gray-400">نظام پزشکی: ............................</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
