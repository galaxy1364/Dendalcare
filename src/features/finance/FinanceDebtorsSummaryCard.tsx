import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type {
  AccountsReceivablePriorityItem,
  ClinicReceivablesSummary,
  FinancialAnomalyItem,
} from './financialLedgerTypes';
import { fmtToman } from './financeConstants';

export function FinanceDebtorsOverview({
  summary,
  arPriorities,
  anomalies,
  showAuditDrawer,
  onToggleAuditDrawer,
  leadDaysBefore,
  onChangeLeadDays,
  syncingReminders,
  syncResultMsg,
  onSyncReminders,
}: {
  summary: ClinicReceivablesSummary;
  arPriorities: AccountsReceivablePriorityItem[];
  anomalies: FinancialAnomalyItem[];
  showAuditDrawer: boolean;
  onToggleAuditDrawer: () => void;
  leadDaysBefore: number;
  onChangeLeadDays: (d: number) => void;
  syncingReminders: boolean;
  syncResultMsg: string | null;
  onSyncReminders: () => void;
}) {
  return (
    <>
      <div
        className="qbank-tile border border-emerald-200"
        style={{
          background: 'linear-gradient(155deg, #FFFFFF 0%, #F1FDF5 60%, #DCFCE7 100%)',
          boxShadow: '0 6px 20px rgba(15, 23, 42, 0.06)',
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-emerald-900 text-[10px] font-extrabold mb-1">
              <ShieldAlert size={11} className="text-emerald-700" />
              <span>مرکز کنترل مطالبات قطعی مطب • واحد رسمی: تومان</span>
            </div>
            <p className="text-xs font-semibold text-slate-600">کل مطالبات و بدهی‌های تاییدشده بیماران</p>
            <p className="text-2xl font-black text-slate-900 tracking-tight mt-0.5 tabular-nums" data-testid="finance_total_receivables">
              {fmtToman(summary.totalReceivables)} <span className="text-xs font-bold text-emerald-700">تومان</span>
            </p>
            {(summary.totalGuaranteeChecksHeld > 0 || summary.totalPlannedEstimatesExcluded > 0) && (
              <p className="text-[10px] text-slate-500 mt-1">
                چک ضمانت نزد مطب (غیرنقدی): <b>{fmtToman(summary.totalGuaranteeChecksHeld)} ت</b>
                {summary.totalPlannedEstimatesExcluded > 0 && ` • طرح درمان پیشنهادی (خارج از بدهی): ${fmtToman(summary.totalPlannedEstimatesExcluded)} ت`}
              </p>
            )}
          </div>
          <div className="w-11 h-11 rounded-2xl bg-white border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-sm">
            <Wallet size={22} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-emerald-200/70">
          <div className="bg-white border border-rose-200 rounded-xl p-2">
            <p className="text-[9px] text-rose-800 font-bold">بدهی باز بدون چک/قسط</p>
            <p className="text-xs font-black text-slate-900 mt-0.5 tabular-nums">{fmtToman(summary.totalUncovered)} ت</p>
          </div>
          <div className="bg-white border border-amber-200 rounded-xl p-2">
            <p className="text-[9px] text-amber-800 font-bold">چک‌های وصولی در جریان</p>
            <p className="text-xs font-black text-slate-900 mt-0.5 tabular-nums">{fmtToman(summary.totalCollectibleChecksInHand)} ت</p>
          </div>
          <div className="bg-white border border-sky-200 rounded-xl p-2">
            <p className="text-[9px] text-sky-800 font-bold">اقساط در جریان</p>
            <p className="text-xs font-black text-slate-900 mt-0.5 tabular-nums">{fmtToman(summary.totalInstallmentsActive)} ت</p>
          </div>
        </div>

        <div className="mt-2 pt-2 border-t border-emerald-200/60 flex items-center justify-between gap-1 text-[9.5px] overflow-x-auto no-scrollbar">
          <span className="px-2 py-0.5 rounded-lg bg-white border border-emerald-100 text-slate-700 whitespace-nowrap">جاری: <b>{fmtToman(summary.aging.current)}</b></span>
          <span className="px-2 py-0.5 rounded-lg bg-white border border-amber-100 text-amber-800 whitespace-nowrap">۱-۳۰ روز: <b>{fmtToman(summary.aging.days_1_30)}</b></span>
          <span className="px-2 py-0.5 rounded-lg bg-white border border-orange-100 text-orange-800 whitespace-nowrap">۳۱-۶۰ روز: <b>{fmtToman(summary.aging.days_31_60)}</b></span>
          <span className="px-2 py-0.5 rounded-lg bg-white border border-rose-200 text-rose-800 whitespace-nowrap">+۶۱ روز: <b>{fmtToman(summary.aging.days_61_90 + summary.aging.over_90)}</b></span>
        </div>
      </div>

      {(arPriorities.length > 0 || anomalies.length > 0) && (
        <div className="glass-card p-3 border border-indigo-200/70">
          <button
            onClick={onToggleAuditDrawer}
            data-testid="finance_ai_audit_toggle"
            className="w-full flex items-center justify-between text-xs font-extrabold text-indigo-900"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles size={15} className="text-indigo-600" />
              اولویت‌بندی پیگیری مطالبات ({arPriorities.length.toLocaleString('fa-IR')}) و کنترل مغایرت ({anomalies.length.toLocaleString('fa-IR')})
            </span>
            {showAuditDrawer ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {showAuditDrawer && (
            <div className="mt-2.5 pt-2.5 border-t border-indigo-100 space-y-2 text-[11px]">
              {arPriorities.map((pr) => (
                <div key={pr.patientId} className="rounded-xl bg-indigo-50/70 p-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-800">{pr.patientName}</p>
                    <p className="text-[10px] text-indigo-800">{pr.reasonsFa.join(' • ')} (بدون محدودیت درمان اورژانس)</p>
                  </div>
                  <span className="font-black text-rose-700 tabular-nums whitespace-nowrap">{fmtToman(pr.totalRemainingDebt)} ت</span>
                </div>
              ))}
              {anomalies.map((an) => (
                <div key={an.id} className="rounded-xl bg-amber-50 border border-amber-200 p-2">
                  <p className="font-bold text-amber-900">{an.titleFa}</p>
                  <p className="text-[10px] text-amber-800">{an.explanationFa}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="glass-card p-3.5 space-y-2.5 border border-emerald-200/80">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center"><BellRing size={16} /></div>
            <div>
              <h3 className="text-xs font-extrabold text-gray-800">سیستم یادآور هوشمند مالی (بدون تکرار)</h3>
              <p className="text-[10px] text-gray-500">محافظت حریم خصوصی در اعلان صفحه قفل + کلید یکتای هر سررسید</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            {[1, 2, 3, 5, 7, 10].map((d) => (
              <button
                key={d}
                onClick={() => onChangeLeadDays(d)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${leadDaysBefore === d ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                {d.toLocaleString('fa-IR')} روز
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onSyncReminders}
          disabled={syncingReminders}
          data-testid="sync_smart_finance_reminders_button"
          className="w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Sparkles size={15} />
          {syncingReminders ? 'در حال ثبت یادآورها...' : `تولید یادآور چک، قسط و بدهی (${leadDaysBefore.toLocaleString('fa-IR')} روز قبل)`}
        </button>
        {syncResultMsg && (
          <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
            <span>{syncResultMsg}</span>
          </div>
        )}
      </div>
    </>
  );
}
