import { useMemo, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  FileSpreadsheet,
  Lock,
  Plus,
  RotateCcw,
  Search,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  supabase,
  type FinanceTransaction,
  type Patient,
  type Payment,
  type Treatment,
} from '@/lib/supabase';
import { Sheet } from '@/components/ui/Sheet';
import { Badge, Button, EmptyState, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { exportToCsv } from '@/lib/exportUtils';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { HapticEngine } from '@/lib/hapticsAudio';
import { getActiveBranchId, getActiveTenantId } from '@/services/authentication/authService';
import {
  computeClinicCashAndOperatingMetrics,
  evaluateDailyCloseReconciliation,
} from './financialLedgerEngine';
import { reverseOrRefundPaymentCommand, submitDayCloseCommand } from './financialCommandService';
import { parseExactTomanAmount } from './monetaryPrecision';
import { CATEGORIES, fmtToman, PAYMENT_METHODS, TXN_TYPES } from './financeConstants';

export function FinanceTransactionsAndCloseTab({
  transactions,
  payments,
  treatments,
  patients,
  refresh,
}: {
  transactions: FinanceTransaction[];
  payments: Payment[];
  treatments: Treatment[];
  patients: Patient[];
  refresh: () => void;
}) {
  const today = todayGregorian();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundMsg, setRefundMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [openingCash, setOpeningCash] = useState('0');
  const [countedCash, setCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeMsg, setCloseMsg] = useState<string | null>(null);

  const metrics = useMemo(
    () =>
      computeClinicCashAndOperatingMetrics({
        tenantId: getActiveTenantId(),
        branchId: getActiveBranchId(),
        treatments,
        payments,
        finance: transactions,
        referenceDateIso: today,
      }),
    [treatments, payments, transactions, today]
  );

  const dayClosePreview = useMemo(() => {
    const openParsed = parseExactTomanAmount(openingCash || '0', { allowZero: true });
    const cntParsed = parseExactTomanAmount(countedCash || '0', { allowZero: true });
    return evaluateDailyCloseReconciliation({
      businessDate: today,
      openingBalance: openParsed.ok ? openParsed.amount : 0,
      countedCash: cntParsed.ok ? cntParsed.amount : 0,
      payments,
    });
  }, [openingCash, countedCash, today, payments]);

  const filtered = useMemo(() => {
    let list = transactions;
    if (filter !== 'all') list = list.filter((t) => t.type === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.description?.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    return [...list].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  }, [transactions, search, filter]);

  const handleSave = async (data: Partial<FinanceTransaction>) => {
    setSaving(true);
    const res = await supabase.from('finance_transactions').insert(data);
    setSaving(false);
    const outcome = getMutationOutcome(res);
    if (outcome === 'error') {
      HapticEngine.error();
      return;
    }
    HapticEngine.success();
    setSheetOpen(false);
    refresh();
  };

  const handleRefundSubmit = async () => {
    if (!refundTarget) return;
    setSaving(true);
    setRefundMsg(null);
    const res = await reverseOrRefundPaymentCommand({
      paymentId: refundTarget.id,
      originalAmountToman: Number(refundTarget.amount),
      refundAmountInput: refundAmount,
      businessDate: today,
      reason: refundReason,
    });
    setSaving(false);
    setRefundMsg(res.messageFa);
    if (res.ok) {
      HapticEngine.success();
      setRefundTarget(null);
      setRefundAmount('');
      setRefundReason('');
      refresh();
    } else {
      HapticEngine.error();
    }
  };

  const handleDayCloseSubmit = async () => {
    setSaving(true);
    setCloseMsg(null);
    const res = await submitDayCloseCommand({
      businessDate: today,
      openingBalanceInput: openingCash || '0',
      countedCashInput: countedCash || '0',
      action: 'close',
      exceptionNotes: closeNotes || (dayClosePreview.hasVariance ? 'تفاوت صندوق گزارش‌شده' : undefined),
    });
    setSaving(false);
    setCloseMsg(res.messageFa);
    if (res.ok) HapticEngine.success();
    else HapticEngine.error();
  };

  const handleExport = () => {
    exportToCsv(
      `گزارش_خزانه_${today}`,
      ['شناسه', 'نوع', 'مبلغ (تومان)', 'دسته‌بندی', 'تاریخ', 'توضیحات'],
      filtered.map((t) => [
        t.id.slice(0, 8),
        TXN_TYPES.find((x) => x.value === t.type)?.label || t.type,
        String(t.amount),
        CATEGORIES.find((c) => c.value === t.category)?.label || t.category,
        toJalaliStr(t.transaction_date),
        t.description || '',
      ])
    );
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-card p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={14} className="text-green-600" />
            <span className="text-[11px] font-semibold text-gray-500">وصولی خالص ماه (پس از استرداد)</span>
          </div>
          <p className="text-base font-black text-green-600 tabular-nums">{fmtToman(metrics.netCollections)} ت</p>
          {metrics.periodRefunds > 0 && <p className="text-[10px] text-rose-600">استرداد دوره: -{fmtToman(metrics.periodRefunds)} ت</p>}
        </div>
        <div className="glass-card p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown size={14} className="text-red-500" />
            <span className="text-[11px] font-semibold text-gray-500">هزینه نقدی خزانه</span>
          </div>
          <p className="text-base font-black text-red-500 tabular-nums">{fmtToman(metrics.cashExpensesTotal)} ت</p>
          {metrics.internalTransfersTotal > 0 && <p className="text-[10px] text-slate-500">انتقال داخلی (خارج از درآمد): {fmtToman(metrics.internalTransfersTotal)} ت</p>}
        </div>
      </div>

      <div className="glass-card p-3 flex items-center justify-between gap-2 flex-wrap" style={{ borderTop: '3px solid #22C55E' }}>
        <div>
          <p className="text-[11px] text-gray-500">خالص جریان نقدی ماه • {metrics.provenance.isProvisional ? 'موقتی/نیازمند بررسی' : 'تطبیق‌شده'}</p>
          <p className={`text-xl font-black tabular-nums ${metrics.netCashFlow >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtToman(metrics.netCashFlow)} ت</p>
        </div>
        <button
          onClick={() => setCloseOpen(true)}
          data-testid="finance_open_day_close_btn"
          className="px-3 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 shadow"
        >
          <Calculator size={14} /> بستن صندوق روزانه
        </button>
      </div>

      <div className="glass-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-gray-700 flex items-center gap-1"><Lock size={13} className="text-emerald-600" /> دفتر تراکنش‌های قطعی (تغییرناپذیر پس از ثبت)</span>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center"><FileSpreadsheet size={15} /></button>
            <button onClick={() => setSheetOpen(true)} className="w-8 h-8 rounded-xl bg-green-500 text-white flex items-center justify-center"><Plus size={18} /></button>
          </div>
        </div>
        <div className="relative mb-2">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="جستجو در تراکنش‌ها..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 text-sm" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {[
            { v: 'all', l: 'همه' },
            { v: 'income', l: 'ورودی' },
            { v: 'expense', l: 'خروجی' },
            { v: 'transfer', l: 'انتقال داخلی' },
          ].map((f) => (
            <button key={f.v} onClick={() => setFilter(f.v)} className={`px-3 py-1.5 rounded-full text-[11px] font-semibold ${filter === f.v ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>{f.l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Wallet size={28} />} title="تراکنشی یافت نشد" color="#22C55E" />
      ) : (
        <div className="space-y-2 stagger">
          {filtered.slice(0, 30).map((t) => {
            const patient = patients.find((p) => p.id === t.patient_id);
            const isIncome = t.type === 'income';
            const linkedPayment = t.payment_id ? payments.find((p) => p.id === t.payment_id) : undefined;
            return (
              <div key={t.id} className="glass-card p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: isIncome ? '#DCFCE7' : '#FEE2E2' }}>
                  {isIncome ? <ArrowUpCircle size={18} className="text-green-600" /> : <ArrowDownCircle size={18} className="text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{t.description ?? t.category}</p>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span>{toJalaliStr(t.transaction_date)}</span>
                    <Badge color="#6B7280" bg="#F3F4F6">{CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}</Badge>
                    {patient && <span>{patient.first_name} {patient.last_name}</span>}
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <p className={`text-sm font-black tabular-nums ${isIncome ? 'text-green-600' : t.type === 'transfer' ? 'text-slate-600' : 'text-red-500'}`}>
                    {isIncome ? '+' : t.type === 'transfer' ? '⇄ ' : '-'}{fmtToman(Number(t.amount))}
                  </p>
                  {linkedPayment && linkedPayment.status === 'completed' ? (
                    <button
                      onClick={() => { setRefundTarget(linkedPayment); setRefundAmount(String(linkedPayment.amount)); setRefundMsg(null); }}
                      className="text-[10px] text-rose-600 font-bold inline-flex items-center gap-0.5"
                    >
                      <RotateCcw size={10} /> سند استرداد/برگشت
                    </button>
                  ) : (
                    <span className="text-[9px] text-gray-400">سند قطعی ثبت‌شده</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="ثبت تراکنش خزانه" icon={<Wallet size={20} />} color="#22C55E">
        <NewTransactionForm patients={patients} onSave={handleSave} saving={saving} />
      </Sheet>

      <Sheet open={!!refundTarget} onClose={() => setRefundTarget(null)} title="صدور سند استرداد/برگشت (فقط مدیر)" icon={<RotateCcw size={20} />} color="#EF4444">
        <div className="space-y-3">
          <Field label="مبلغ استرداد (تومان)"><Input type="text" inputMode="numeric" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} /></Field>
          <Field label="دلیل ممیزی استرداد (الزامی)"><Textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={2} /></Field>
          {refundMsg && <p className="text-xs font-bold text-rose-700">{refundMsg}</p>}
          <Button color="#EF4444" disabled={saving || !refundReason.trim()} className="w-full" onClick={handleRefundSubmit}>ثبت سند برگشت (حفظ تاریخچه)</Button>
        </div>
      </Sheet>

      <Sheet open={closeOpen} onClose={() => setCloseOpen(false)} title={`بستن صندوق روزانه (${toJalaliStr(today)})`} icon={<Calculator size={20} />} color="#0F172A">
        <div className="space-y-3" data-testid="finance_day_close_sheet">
          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl">
            <span>نقدی انتظاری امروز: <b>{fmtToman(dayClosePreview.expectedCash)} ت</b></span>
            <span>کارت‌خوان امروز: <b>{fmtToman(dayClosePreview.expectedCard)} ت</b></span>
            <span>انتقال بانکی: <b>{fmtToman(dayClosePreview.expectedTransfer)} ت</b></span>
            <span>استرداد نقدی: <b>{fmtToman(dayClosePreview.expectedRefunds)} ت</b></span>
          </div>
          <Field label="موجودی اول وقت صندوق (تومان)"><Input type="text" inputMode="numeric" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} /></Field>
          <Field label="شمارش نقدی پایان شیفت (تومان)"><Input type="text" inputMode="numeric" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="مبلغ شمارش‌شده..." /></Field>
          <div className={`p-2.5 rounded-xl text-xs font-bold ${dayClosePreview.hasVariance ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
            اختلاف صندوق: {fmtToman(dayClosePreview.varianceAmount)} تومان {dayClosePreview.hasVariance ? '(نیازمند ثبت توضیح)' : '(تطبیق کامل)'}
          </div>
          <Field label="توضیح اختلاف / یادداشت بستن صندوق"><Textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} rows={2} /></Field>
          {closeMsg && <p className="text-xs font-bold text-slate-800">{closeMsg}</p>}
          <Button color="#0F172A" disabled={saving} className="w-full" onClick={handleDayCloseSubmit}>تأیید و بستن صندوق روزانه</Button>
        </div>
      </Sheet>
    </>
  );
}

function NewTransactionForm({ patients, onSave, saving }: { patients: Patient[]; onSave: (d: Partial<FinanceTransaction>) => void; saving: boolean }) {
  const [form, setForm] = useState({ type: 'expense', category: 'supplies', amount: '', transaction_date: todayGregorian(), description: '', patient_id: '', payment_method: 'cash', reference: '' });
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = parseExactTomanAmount(form.amount, { allowZero: false });
    if (!parsed.ok) {
      setError(parsed.messageFa);
      return;
    }
    onSave({ ...form, type: form.type as any, amount: parsed.amount, patient_id: form.patient_id || null });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="نوع"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={TXN_TYPES} /></Field>
        <Field label="دسته‌بندی"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={CATEGORIES} /></Field>
      </div>
      <Field label="مبلغ (تومان)"><Input type="text" inputMode="numeric" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setError(null); }} placeholder="مبلغ صحیح" /></Field>
      <Field label="تاریخ"><JalaliDatePicker value={form.transaction_date} onChange={(v) => setForm({ ...form, transaction_date: v })} /></Field>
      <Field label="شرح"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="روش"><Select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} options={PAYMENT_METHODS} /></Field>
        <Field label="بیمار"><Select value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} options={[{ value: '', label: 'بدون بیمار' }, ...patients.map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}` }))]} /></Field>
      </div>
      {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      <Button onClick={submit} color="#22C55E" disabled={saving} className="w-full">{saving ? 'در حال ثبت...' : 'ذخیره تراکنش'}</Button>
    </div>
  );
}
