import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, Plus, Trash2 } from 'lucide-react';
import { supabase, type Installment, type Patient } from '@/lib/supabase';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { Badge, Button, EmptyState, Field, Input, Select } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { todayGregorian } from '@/lib/jalali';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { HapticEngine } from '@/lib/hapticsAudio';
import { buildStableFinanceReminderPayload } from './financialLedgerEngine';
import { postPatientPaymentCommand } from './financialCommandService';
import { parseExactTomanAmount } from './monetaryPrecision';
import { addDaysToIso, fmtToman, INSTALLMENT_STATUS } from './financeConstants';

export function FinanceInstallmentsTab({
  installments,
  patients,
  refresh,
}: {
  installments: Installment[];
  patients: Patient[];
  refresh: () => void;
}) {
  const today = todayGregorian();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const collectionLock = useRef(false);
  const [collecting, setCollecting] = useState(false);
  const [collectionMessage, setCollectionMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    patient_id: '',
    total_amount: '',
    monthly_amount: '',
    total_months: '',
    start_date: today,
    notes: '',
  });

  const getPatient = (id: string | null) => patients.find((p) => p.id === id);

  const stats = useMemo(() => {
    const active = installments.filter((i) => i.status === 'active');
    const totalDebt = active.reduce((s, i) => s + Math.max(0, Number(i.total_amount) - Number(i.paid_amount)), 0);
    const overdueCount = active.filter((i) => i.next_due_date && i.next_due_date < today).length;
    return { totalDebt, overdueCount, active: active.length };
  }, [installments, today]);

  const save = async () => {
    setFormError(null);
    const parsedTotal = parseExactTomanAmount(form.total_amount, { allowZero: false });
    if (!form.patient_id || !parsedTotal.ok) {
      setFormError(!parsedTotal.ok ? parsedTotal.messageFa : 'انتخاب بیمار الزامی است.');
      return;
    }
    const months = Math.max(1, Number(form.total_months) || 1);
    let monthly = Math.round(parsedTotal.amount / months);
    if (form.monthly_amount.trim()) {
      const parsedMonthly = parseExactTomanAmount(form.monthly_amount, { allowZero: false });
      if (!parsedMonthly.ok) {
        setFormError(parsedMonthly.messageFa);
        return;
      }
      monthly = parsedMonthly.amount;
    }

    setSaving(true);
    const nextDue = new Date(form.start_date);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const nextDueStr = nextDue.toISOString().slice(0, 10);

    const res = await supabase.from('installments').insert({
      patient_id: form.patient_id,
      total_amount: parsedTotal.amount,
      paid_amount: 0,
      monthly_amount: monthly,
      total_months: months,
      paid_months: 0,
      start_date: form.start_date,
      next_due_date: nextDueStr,
      status: 'active',
      notes: form.notes || null,
    });
    if (getMutationOutcome(res) === 'error') {
      setSaving(false);
      HapticEngine.error();
      return;
    }

    const patient = getPatient(form.patient_id);
    if (patient) {
      const rem = buildStableFinanceReminderPayload({
        kind: 'installment_due',
        entityId: `new_${form.patient_id}`,
        patient,
        targetDateIso: nextDueStr,
        leadDaysBefore: 3,
        amountToman: monthly,
        todayIso: today,
      });
      await supabase.from('reminders').insert({
        patient_id: rem.patientId,
        title: rem.lockScreenSafeTitle,
        description: rem.authenticatedDetail,
        reminder_date: rem.reminderDate,
        reminder_time: rem.reminderTime,
        category: rem.category,
        priority: rem.priority,
        status: 'pending',
      });
    }

    HapticEngine.success();
    setSaving(false);
    setShowForm(false);
    setForm({ patient_id: '', total_amount: '', monthly_amount: '', total_months: '', start_date: today, notes: '' });
    refresh();
  };

  const recordPayment = async (inst: Installment) => {
    if (collectionLock.current || inst.status !== 'active' || !inst.patient_id) return;
    collectionLock.current = true;
    setCollecting(true);
    setCollectionMessage(null);
    try {
      const payRes = await postPatientPaymentCommand({
        patientId: inst.patient_id,
        amountInput: Number(inst.monthly_amount),
        paymentMethod: 'installment',
        businessDate: today,
        description: `دریافت قسط شماره ${inst.paid_months + 1}`,
        installmentId: inst.id,
        idempotencyKey: `inst_${inst.id}_m_${inst.paid_months + 1}`,
      });
      // Queued/unknown/rejected requests are not confirmed receipts.
      if (!payRes.ok || payRes.resolution !== 'confirmed') {
        setCollectionMessage(payRes.messageFa + ' وضعیت قسط تغییر نکرد؛ پیش از تلاش مجدد دریافت وجه را بررسی کنید.');
        return;
      }
      const newPaid = Number(inst.paid_amount) + Number(inst.monthly_amount);
      const newMonths = inst.paid_months + 1;
      const isComplete = newPaid >= Number(inst.total_amount);
      const nextDue = addDaysToIso(inst.next_due_date || today, 30);
      // This remains a separate write; never describe partial completion as atomic.
      const updated = await supabase.from('installments').update({
        paid_amount: newPaid, paid_months: newMonths,
        next_due_date: isComplete ? null : nextDue,
        status: isComplete ? 'completed' : 'active',
      }).eq('id', inst.id).eq('paid_months', inst.paid_months);
      if (getMutationOutcome(updated) !== 'confirmed') {
        setCollectionMessage('دریافت وجه تأیید شد، اما وضعیت قسط نیازمند تطبیق است. وجه را دوباره ثبت نکنید.');
        refresh();
        return;
      }
      HapticEngine.success();
      refresh();
      setCollectionMessage('دریافت وجه و به‌روزرسانی وضعیت قسط تأیید شد.');
    } catch {
      setCollectionMessage('نتیجه عملیات نامشخص است؛ پیش از ثبت مجدد، دفتر کل و وضعیت قسط را بررسی کنید.');
    } finally {
      collectionLock.current = false;
      setCollecting(false);
    }
  };

  const del = async (id: string) => {
    await supabase.from('installments').delete().eq('id', id);
    refresh();
  };

  return (
    <>
      {collectionMessage && <p role="status" className="text-sm text-slate-700 dark:text-slate-200 p-2">{collectionMessage}</p>}
      <div className="glass-card p-3" style={{ borderTop: '3px solid #22C55E' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-500">باقی‌مانده اقساط فعال نزد مطب</p>
            <p className="text-xl font-black text-green-600 tabular-nums">{fmtToman(stats.totalDebt)} ت</p>
          </div>
          <div className="text-left">
            <p className="text-[10px] text-gray-400">اقساط فعال: <b className="text-gray-700">{stats.active.toLocaleString('fa-IR')}</b></p>
            {stats.overdueCount > 0 && <p className="text-[10px] text-red-500 flex items-center gap-1 justify-end"><AlertTriangle size={10} /> {stats.overdueCount} معوق</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">طرح‌های اقساطی بیماران</span>
        <button onClick={() => setShowForm(true)} className="px-3 h-8 rounded-xl bg-green-500 text-white text-xs font-bold flex items-center gap-1 shadow">
          <Plus size={16} /> اقساط جدید
        </button>
      </div>

      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت طرح اقساطی جدید" icon={<CreditCard size={20} />} color="#22C55E">
        <div className="space-y-3.5">
          <Field label="بیمار"><Select value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} options={[{ value: '', label: 'انتخاب...' }, ...patients.map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}` }))]} /></Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="مبلغ کل (تومان)"><Input type="text" inputMode="numeric" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} placeholder="مثلاً ۶۰۰۰۰۰۰" /></Field>
            <Field label="مبلغ هر قسط"><Input type="text" inputMode="numeric" value={form.monthly_amount} onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })} placeholder="محاسبه خودکار" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="تعداد اقساط"><Input type="text" inputMode="numeric" value={form.total_months} onChange={(e) => setForm({ ...form, total_months: e.target.value })} placeholder="۶" /></Field>
            <Field label="تاریخ شروع"><JalaliDatePicker value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          {formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}
          <Button color="#22C55E" disabled={saving || !form.patient_id || !form.total_amount} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت طرح اقساطی'}</Button>
        </div>
      </Sheet>

      {installments.length === 0 ? (
        <EmptyState icon={<CreditCard size={28} />} title="طرح اقساطی ثبت نشده" color="#22C55E" />
      ) : (
        <div className="space-y-2 stagger">
          {installments.map((inst) => {
            const patient = getPatient(inst.patient_id);
            const status = INSTALLMENT_STATUS[inst.status] ?? INSTALLMENT_STATUS.active;
            const balance = Math.max(0, Number(inst.total_amount) - Number(inst.paid_amount));
            const progress = Math.min(100, (Number(inst.paid_amount) / Math.max(Number(inst.total_amount), 1)) * 100);
            return (
              <div key={inst.id} className="glass-card p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-gray-800">{patient ? `${patient.first_name} ${patient.last_name}` : 'نامشخص'}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                    <button onClick={() => setDeleteId(inst.id)} className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400"><Trash2 size={12} /></button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400 tabular-nums">وصول‌شده: {fmtToman(Number(inst.paid_amount))} / {fmtToman(Number(inst.total_amount))}</span>
                  <span className="font-bold text-green-600">{Math.round(progress).toLocaleString('fa-IR')}٪</span>
                </div>
                <div className="prog-track h-2 mb-2"><div className="prog-fill" style={{ width: `${progress}%`, background: '#22C55E' }} /></div>
                {balance > 0 && inst.status === 'active' && (
                  <button disabled={collecting} onClick={() => recordPayment(inst)} className="w-full py-2 rounded-xl bg-green-500 text-white text-xs font-bold flex items-center justify-center gap-1">
                    <CheckCircle2 size={14} /> ثبت وصول قسط ({fmtToman(Number(inst.monthly_amount))} ت)
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del(deleteId)} title="حذف طرح اقساطی" message="آیا مطمئن هستید؟" confirmLabel="حذف" />
    </>
  );
}
