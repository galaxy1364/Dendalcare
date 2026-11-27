import { useRef, useState } from 'react';
import {
  Wallet, CreditCard, ScrollText, ArrowUpCircle, CalendarClock,
} from 'lucide-react';
import {
  supabase,
  type Treatment, type Payment, type Installment, type Check as CheckType, type Safteh,
} from '@/lib/supabase';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Select, Button, Badge } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { isGuaranteeCheck } from '@/features/dashboard/dashboard.metrics';
import { clearOrBounceInstrumentCommand, postPatientPaymentCommand } from '@/features/finance/financialCommandService';
import { parseExactTomanAmount } from '@/features/finance/monetaryPrecision';
import { SectionHeader, EmptyHint, DeleteBtn } from './PatientClinicalTabs';

export {
  LAB_WORK_TYPES,
  IMPLANT_STAGES,
  REMINDER_CATEGORIES,
  REMINDER_PRIORITIES,
  LAB_STATUS,
  LabTab,
  ImplantsTab,
  RemindersTab,
} from './PatientSpecialtyTabs';

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقدی' },
  { value: 'card', label: 'کارت' },
  { value: 'transfer', label: 'انتقال بانکی' },
  { value: 'insurance', label: 'بیمه' },
  { value: 'installment', label: 'اقساط' },
];

export const CHECK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'در جریان', color: '#F59E0B', bg: '#FEF3C7' },
  cleared: { label: 'وصول‌شده', color: '#22C55E', bg: '#DCFCE7' },
  bounced: { label: 'برگشت‌خورده', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'باطل‌شده', color: '#9CA3AF', bg: '#F3F4F6' },
};

export const INSTALLMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'فعال', color: '#3B82F6', bg: '#DBEAFE' },
  completed: { label: 'تکمیل‌شده', color: '#22C55E', bg: '#DCFCE7' },
  overdue: { label: 'معوق', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'لغوشده', color: '#9CA3AF', bg: '#F3F4F6' },
};

export function PaymentsTab({ patientId, payments, treatments }: { patientId: string; payments: Payment[]; treatments: Treatment[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'insurance' | 'installment'>('cash');
  const [desc, setDesc] = useState('');
  const [treatmentId, setTreatmentId] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const save = async () => {
    setErrorMsg(null);
    const parsed = parseExactTomanAmount(amount, { allowZero: false });
    if (!parsed.ok) {
      setErrorMsg(parsed.messageFa);
      return;
    }
    setSaving(true);
    const selectedTreat = treatmentId ? treatments.filter((t) => t.id === treatmentId) : treatments;
    const res = await postPatientPaymentCommand({
      patientId,
      amountInput: parsed.amount,
      paymentMethod: method,
      businessDate: todayGregorian(),
      description: desc || undefined,
      treatmentsForDeterministicAllocation: selectedTreat,
    });
    setSaving(false);
    if (!res.ok && res.resolution !== 'queued') {
      setErrorMsg(res.messageFa);
      return;
    }
    setShowForm(false);
    setAmount('');
    setDesc('');
    setTreatmentId('');
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="پرداخت‌ها" count={payments.length} onAdd={() => setShowForm(true)} color="#22C55E" icon={<Wallet size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت دریافت پرداخت از بیمار" icon={<Wallet size={20} />} color="#22C55E">
        <div className="space-y-4">
          <Field label="مبلغ (تومان)"><Input type="text" inputMode="numeric" value={amount} onChange={e => { setAmount(e.target.value); setErrorMsg(null); }} placeholder="مبلغ پرداخت به تومان" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="روش پرداخت"><Select value={method} onChange={e => setMethod(e.target.value as any)} options={PAYMENT_METHODS} /></Field>
            <Field label="درمان مرتبط">
              <Select value={treatmentId} onChange={e => setTreatmentId(e.target.value)} options={[{ value: '', label: 'تخصیص خودکار' }, ...treatments.map(t => ({ value: t.id, label: t.diagnosis ?? 'درمان' }))]} />
            </Field>
          </div>
          <Field label="شرح"><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="شرح پرداخت..." /></Field>
          {errorMsg && <p className="text-xs font-bold text-rose-600">{errorMsg}</p>}
          <Button color="#22C55E" disabled={saving || !amount} className="w-full" onClick={save}>{saving ? 'در حال ثبت اتمیک...' : 'ثبت پرداخت'}</Button>
        </div>
      </Sheet>
      {payments.length === 0 ? <EmptyHint text="پرداختی ثبت نشده — روی + پرداخت جدید ثبت کنید" /> : payments.map(p => (
        <div key={p.id} className="glass-card p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center"><ArrowUpCircle size={18} className="text-green-600" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-700 tabular-nums">{Number(p.amount).toLocaleString('fa-IR')} ت</p>
              <p className="text-[10px] text-gray-400">{toJalaliStr(p.payment_date)} • {PAYMENT_METHODS.find(m => m.value === p.payment_method)?.label ?? p.payment_method}</p>
            </div>
            <Badge color={p.status === 'refunded' ? '#EF4444' : '#22C55E'} bg={p.status === 'refunded' ? '#FEE2E2' : '#DCFCE7'}>
              {p.status === 'refunded' ? 'استرداد' : p.status}
            </Badge>
          </div>
          {p.description && <p className="text-xs text-gray-500 mt-1">{p.description}</p>}
        </div>
      ))}
    </div>
  );
}

export function InstallmentsTab({ patientId, installments }: { patientId: string; installments: Installment[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const collectionLock = useRef(false);
  const [collecting, setCollecting] = useState(false);
  const [collectionMessage, setCollectionMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ total_amount: '', monthly_amount: '', total_months: '1', start_date: todayGregorian(), notes: '' });

  const save = async () => {
    setErrorMsg(null);
    const parsedTotal = parseExactTomanAmount(form.total_amount, { allowZero: false });
    if (!parsedTotal.ok) {
      setErrorMsg(parsedTotal.messageFa);
      return;
    }
    const months = Math.max(1, Number(form.total_months) || 1);
    const parsedMonthly = form.monthly_amount.trim()
      ? parseExactTomanAmount(form.monthly_amount, { allowZero: false })
      : null;
    if (parsedMonthly && !parsedMonthly.ok) {
      setErrorMsg(parsedMonthly.messageFa);
      return;
    }
    const monthly = parsedMonthly && parsedMonthly.ok ? parsedMonthly.amount : Math.ceil(parsedTotal.amount / months);
    setSaving(true);
    const startDate = new Date(form.start_date);
    const nextDue = new Date(startDate); nextDue.setMonth(nextDue.getMonth() + 1);
    const res = await supabase.from('installments').insert({
      patient_id: patientId, total_amount: parsedTotal.amount, paid_amount: 0,
      monthly_amount: monthly, total_months: months, paid_months: 0,
      start_date: form.start_date, next_due_date: nextDue.toISOString().slice(0, 10),
      status: 'active', notes: form.notes || null,
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') return;
    setShowForm(false);
    setForm({ total_amount: '', monthly_amount: '', total_months: '1', start_date: todayGregorian(), notes: '' });
  };

  const payInstallment = async (inst: Installment) => {
    if (collectionLock.current || inst.status !== 'active') return;
    collectionLock.current = true;
    setCollecting(true);
    setCollectionMessage(null);
    try {
      const payRes = await postPatientPaymentCommand({
        patientId: patientId,
        amountInput: Number(inst.monthly_amount),
        paymentMethod: 'installment',
        businessDate: todayGregorian(),
        description: `قسط ${inst.paid_months + 1}/${inst.total_months}`,
        installmentId: inst.id,
        idempotencyKey: `patient_inst_${inst.id}_${inst.paid_months + 1}`,
      });
      // Queued/unknown/rejected requests are not confirmed receipts.
      if (!payRes.ok || payRes.resolution !== 'confirmed') {
        setCollectionMessage(payRes.messageFa + ' وضعیت قسط تغییر نکرد؛ پیش از تلاش مجدد دریافت وجه را بررسی کنید.');
        return;
      }
      const newPaid = Number(inst.paid_amount) + Number(inst.monthly_amount);
      const newMonths = inst.paid_months + 1;
      const nextDue = new Date(inst.next_due_date ?? new Date()); nextDue.setMonth(nextDue.getMonth() + 1);
      const status = newMonths >= inst.total_months ? 'completed' : 'active';
      // This remains a separate write; never describe partial completion as atomic.
      const updated = await supabase.from('installments').update({
        paid_amount: newPaid, paid_months: newMonths,
        next_due_date: status === 'completed' ? null : nextDue.toISOString().slice(0, 10),
        status: status,
      }).eq('id', inst.id).eq('paid_months', inst.paid_months);
      if (getMutationOutcome(updated) !== 'confirmed') {
        setCollectionMessage('دریافت وجه تأیید شد، اما وضعیت قسط نیازمند تطبیق است. وجه را دوباره ثبت نکنید.');
        
        return;
      }
      
      setCollectionMessage('دریافت وجه و به‌روزرسانی وضعیت قسط تأیید شد.');
    } catch {
      setCollectionMessage('نتیجه عملیات نامشخص است؛ پیش از ثبت مجدد، دفتر کل و وضعیت قسط را بررسی کنید.');
    } finally {
      collectionLock.current = false;
      setCollecting(false);
    }
  };

  const del = async (id: string) => { await supabase.from('installments').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      {collectionMessage && <p role="status" className="text-sm text-slate-700 dark:text-slate-200 p-2">{collectionMessage}</p>}
      <SectionHeader title="اقساط" count={installments.length} onAdd={() => setShowForm(true)} color="#3B82F6" icon={<CreditCard size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="تعریف پلن اقساطی جدید" icon={<CreditCard size={20} />} color="#3B82F6">
        <div className="space-y-4">
          <Field label="مبلغ کل (تومان)"><Input type="text" inputMode="numeric" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })} placeholder="مبلغ کل" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="مبلغ هر قسط"><Input type="text" inputMode="numeric" value={form.monthly_amount} onChange={e => setForm({ ...form, monthly_amount: e.target.value })} placeholder="خودی محاسبه می‌شود" /></Field>
            <Field label="تعداد اقساط"><Input type="text" inputMode="numeric" value={form.total_months} onChange={e => setForm({ ...form, total_months: e.target.value })} /></Field>
          </div>
          <Field label="تاریخ شروع"><JalaliDatePicker value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} /></Field>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          {errorMsg && <p className="text-xs font-bold text-rose-600">{errorMsg}</p>}
          <Button color="#3B82F6" disabled={saving || !form.total_amount} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت پلن اقساطی'}</Button>
        </div>
      </Sheet>
      {installments.length === 0 ? <EmptyHint text="پلن اقساطی ثبت نشده — روی + پلن جدید بسازید" /> : installments.map(inst => {
        const status = INSTALLMENT_STATUS[inst.status] ?? INSTALLMENT_STATUS.active;
        const remaining = Math.max(0, Number(inst.total_amount) - Number(inst.paid_amount));
        const progress = Number(inst.total_amount) > 0 ? Math.min(100, (Number(inst.paid_amount) / Number(inst.total_amount)) * 100) : 0;
        return (
          <div key={inst.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-700">پلن اقساطی {inst.total_months} ماهه</p>
              <div className="flex items-center gap-2">
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(inst.id)} />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-gray-400">پرداخت‌شده: {Number(inst.paid_amount).toLocaleString('fa-IR')} ت</span>
              <span className="text-gray-400">باقی: {remaining.toLocaleString('fa-IR')} ت</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: '#3B82F6' }} />
            </div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-blue-500 font-semibold">{inst.paid_months}/{inst.total_months} قسط</span>
              <span className="text-gray-400">هر قسط: {Number(inst.monthly_amount).toLocaleString('fa-IR')} ت</span>
            </div>
            {inst.next_due_date && (
              <div className="flex items-center gap-1.5 text-xs text-amber-500 mb-2">
                <CalendarClock size={12} /> سررسید بعدی: {toJalaliStr(inst.next_due_date ?? '')}
              </div>
            )}
            {inst.status === 'active' && (
              <Button disabled={collecting} color="#3B82F6" className="w-full" onClick={() => payInstallment(inst)}>ثبت پرداخت قسط ({Number(inst.monthly_amount).toLocaleString('fa-IR')} ت)</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ChecksTab({ patientId, checks, installments }: { patientId: string; checks: CheckType[]; installments: Installment[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ check_number: '', bank_name: '', amount: '', issue_date: todayGregorian(), due_date: '', installment_id: '', is_guarantee: false, notes: '' });

  const save = async () => {
    setErrorMsg(null);
    const parsedAmt = parseExactTomanAmount(form.amount, { allowZero: false });
    if (!parsedAmt.ok || !form.due_date) {
      setErrorMsg(!parsedAmt.ok ? parsedAmt.messageFa : 'تاریخ سررسید الزامی است.');
      return;
    }
    setSaving(true);
    const res = await supabase.from('checks').insert({
      patient_id: patientId, check_number: form.check_number || null,
      bank_name: form.bank_name || null, amount: parsedAmt.amount,
      issue_date: form.issue_date, due_date: form.due_date,
      installment_id: form.installment_id || null, notes: form.notes || null,
      is_guarantee: form.is_guarantee,
      type: form.is_guarantee ? 'guarantee' : 'collectible',
      status: 'pending',
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') return;
    setShowForm(false);
    setForm({ check_number: '', bank_name: '', amount: '', issue_date: todayGregorian(), due_date: '', installment_id: '', is_guarantee: false, notes: '' });
  };
  const updateStatus = async (ch: CheckType, nextStatus: 'cleared' | 'bounced') => {
    await clearOrBounceInstrumentCommand({ kind: 'check', record: ch, nextStatus });
  };
  const del = async (id: string) => { await supabase.from('checks').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="چک‌ها" count={checks.length} onAdd={() => setShowForm(true)} color="#F59E0B" icon={<ScrollText size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت چک جدید بیمار" icon={<ScrollText size={20} />} color="#F59E0B">
        <div className="space-y-4">
          <Field label="نوع چک">
            <Select value={form.is_guarantee ? 'guarantee' : 'collectible'} onChange={e => setForm({ ...form, is_guarantee: e.target.value === 'guarantee' })} options={[{ value: 'collectible', label: 'وصولی (کسر از بدهی پس از وصول)' }, { value: 'guarantee', label: 'چک ضمانت (وثیقه غیرنقدی)' }]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="شماره چک"><Input value={form.check_number} onChange={e => setForm({ ...form, check_number: e.target.value })} placeholder="شماره چک" /></Field>
            <Field label="نام بانک"><Input value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="نام بانک" /></Field>
          </div>
          <Field label="مبلغ (تومان)"><Input type="text" inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="مبلغ چک" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاریخ صدور"><JalaliDatePicker value={form.issue_date} onChange={v => setForm({ ...form, issue_date: v })} /></Field>
            <Field label="تاریخ سررسید"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
          </div>
          {installments.length > 0 && (
            <Field label="پلن اقساطی مرتبط">
              <Select value={form.installment_id} onChange={e => setForm({ ...form, installment_id: e.target.value })} options={[{ value: '', label: 'بدون پلن' }, ...installments.map(i => ({ value: i.id, label: `اقساط ${i.total_months} ماهه` }))]} />
            </Field>
          )}
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          {errorMsg && <p className="text-xs font-bold text-rose-600">{errorMsg}</p>}
          <Button color="#F59E0B" disabled={saving || !form.amount || !form.due_date} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت چک'}</Button>
        </div>
      </Sheet>
      {checks.length === 0 ? <EmptyHint text="چکی ثبت نشده — روی + چک جدید ثبت کنید" /> : checks.map(c => {
        const status = CHECK_STATUS[c.status] ?? CHECK_STATUS.pending;
        const guarantee = isGuaranteeCheck(c);
        return (
          <div key={c.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">چک {c.check_number ?? ''}</p>
              <div className="flex items-center gap-2">
                {guarantee && <Badge color="#475569" bg="#E2E8F0">ضمانت</Badge>}
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(c.id)} />
              </div>
            </div>
            <p className="text-sm font-bold text-amber-600 tabular-nums">{Number(c.amount).toLocaleString('fa-IR')} ت</p>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
              {c.bank_name && <span>بانک: {c.bank_name}</span>}
              <span className="flex items-center gap-1"><CalendarClock size={11} /> سررسید: {toJalaliStr(c.due_date)}</span>
            </div>
            {c.notes && <p className="text-xs text-gray-500 mt-1">{c.notes}</p>}
            {c.status === 'pending' && (
              <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <button onClick={() => updateStatus(c, 'cleared')} className="flex-1 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic">{guarantee ? 'عودت/ابطال ضمانت' : 'وصول شد'}</button>
                <button onClick={() => updateStatus(c, 'bounced')} className="flex-1 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-semibold haptic">برگشت خورد</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SaftehTab({ patientId, safteh }: { patientId: string; safteh: Safteh[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ safteh_number: '', amount: '', issue_date: todayGregorian(), due_date: '', guarantor_name: '', guarantor_national_id: '', notes: '' });

  const save = async () => {
    setErrorMsg(null);
    const parsedAmt = parseExactTomanAmount(form.amount, { allowZero: false });
    if (!parsedAmt.ok || !form.due_date) {
      setErrorMsg(!parsedAmt.ok ? parsedAmt.messageFa : 'تاریخ سررسید الزامی است.');
      return;
    }
    setSaving(true);
    const res = await supabase.from('safteh').insert({
      patient_id: patientId, safteh_number: form.safteh_number || null,
      amount: parsedAmt.amount, issue_date: form.issue_date, due_date: form.due_date,
      guarantor_name: form.guarantor_name || null,
      guarantor_national_id: form.guarantor_national_id || null,
      status: 'pending', notes: form.notes || null,
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') return;
    setShowForm(false);
    setForm({ safteh_number: '', amount: '', issue_date: todayGregorian(), due_date: '', guarantor_name: '', guarantor_national_id: '', notes: '' });
  };
  const updateStatus = async (sf: Safteh, nextStatus: 'cleared' | 'bounced') => {
    await clearOrBounceInstrumentCommand({ kind: 'safteh', record: sf, nextStatus });
  };
  const del = async (id: string) => { await supabase.from('safteh').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="سفته‌ها" count={safteh.length} onAdd={() => setShowForm(true)} color="#6366F1" icon={<ScrollText size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت سفته ضمانت جدید" icon={<ScrollText size={20} />} color="#6366F1">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="شماره سفته"><Input value={form.safteh_number} onChange={e => setForm({ ...form, safteh_number: e.target.value })} placeholder="شماره سفته" /></Field>
            <Field label="مبلغ (تومان)"><Input type="text" inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="مبلغ" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاریخ صدور"><JalaliDatePicker value={form.issue_date} onChange={v => setForm({ ...form, issue_date: v })} /></Field>
            <Field label="تاریخ سررسید"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نام ضامن"><Input value={form.guarantor_name} onChange={e => setForm({ ...form, guarantor_name: e.target.value })} placeholder="نام ضامن" /></Field>
            <Field label="کد ملی ضامن"><Input value={form.guarantor_national_id} onChange={e => setForm({ ...form, guarantor_national_id: e.target.value })} placeholder="کد ملی ضامن" /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          {errorMsg && <p className="text-xs font-bold text-rose-600">{errorMsg}</p>}
          <Button color="#6366F1" disabled={saving || !form.amount || !form.due_date} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت سفته'}</Button>
        </div>
      </Sheet>
      {safteh.length === 0 ? <EmptyHint text="سفته‌ای ثبت نشده — روی + سفته جدید ثبت کنید" /> : safteh.map(sf => {
        const status = CHECK_STATUS[sf.status] ?? CHECK_STATUS.pending;
        return (
          <div key={sf.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">سفته {sf.safteh_number ?? ''}</p>
              <div className="flex items-center gap-2">
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(sf.id)} />
              </div>
            </div>
            <p className="text-sm font-bold text-indigo-600 tabular-nums">{Number(sf.amount).toLocaleString('fa-IR')} ت</p>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
              <span className="flex items-center gap-1"><CalendarClock size={11} /> سررسید: {toJalaliStr(sf.due_date)}</span>
            </div>
            {sf.guarantor_name && <p className="text-xs text-gray-500 mt-1">ضامن: {sf.guarantor_name}{sf.guarantor_national_id ? ` (${sf.guarantor_national_id})` : ''}</p>}
            {sf.notes && <p className="text-xs text-gray-500 mt-1">{sf.notes}</p>}
            {sf.status === 'pending' && (
              <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <button onClick={() => updateStatus(sf, 'cleared')} className="flex-1 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic">تسویه شد</button>
                <button onClick={() => updateStatus(sf, 'bounced')} className="flex-1 py-1.5 rounded-lg bg-red-50 text-red-500 text-xs font-semibold haptic">برگشت خورد</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
