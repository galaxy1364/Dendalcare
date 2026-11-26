import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileCheck,
  FileSpreadsheet,
  Plus,
  ScrollText,
  Trash2,
  User,
  XCircle,
} from 'lucide-react';
import {
  supabase,
  type Check,
  type Patient,
  type Safteh,
} from '@/lib/supabase';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { Badge, Button, EmptyState, Field, Input, Select } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { exportToCsv } from '@/lib/exportUtils';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { HapticEngine } from '@/lib/hapticsAudio';
import { isGuaranteeCheck } from '@/features/dashboard/dashboard.metrics';
import { clearOrBounceInstrumentCommand } from './financialCommandService';
import { parseExactTomanAmount } from './monetaryPrecision';
import { CHECK_STATUS, fmtToman } from './financeConstants';

export { FinanceInstallmentsTab } from './FinanceInstallmentsTab';

export function FinanceChecksTab({
  checks,
  patients,
  refresh,
}: {
  checks: Check[];
  patients: Patient[];
  refresh: () => void;
}) {
  const today = todayGregorian();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    patient_id: '',
    check_number: '',
    sayad_id: '',
    bank_name: '',
    amount: '',
    issue_date: today,
    due_date: '',
    is_guarantee: false,
    notes: '',
  });

  const getPatient = (id: string | null) => patients.find((p) => p.id === id);

  const stats = useMemo(() => {
    const pendingCollectible = checks.filter((c) => c.status === 'pending' && !isGuaranteeCheck(c));
    const pendingGuarantee = checks.filter((c) => c.status === 'pending' && isGuaranteeCheck(c));
    return {
      totalPendingCollectible: pendingCollectible.reduce((s, c) => s + Number(c.amount), 0),
      totalPendingGuarantee: pendingGuarantee.reduce((s, c) => s + Number(c.amount), 0),
      overdue: pendingCollectible.filter((c) => c.due_date < today).length,
      count: pendingCollectible.length,
    };
  }, [checks, today]);

  const handleExportChecks = () => {
    exportToCsv(
      `گزارش_چک_ها_${today}`,
      ['نام بیمار', 'شماره چک', 'نوع سند', 'بانک', 'مبلغ (تومان)', 'سررسید', 'وضعیت'],
      checks.map((c) => {
        const p = getPatient(c.patient_id);
        return [
          p ? `${p.first_name} ${p.last_name}` : '-',
          c.check_number || '-',
          isGuaranteeCheck(c) ? 'ضمانت (غیرنقدی)' : 'وصولی',
          c.bank_name || '-',
          String(c.amount),
          toJalaliStr(c.due_date),
          CHECK_STATUS[c.status]?.label || c.status,
        ];
      })
    );
  };

  const save = async () => {
    setFormError(null);
    const parsedAmt = parseExactTomanAmount(form.amount, { allowZero: false });
    if (!form.patient_id || !parsedAmt.ok || !form.due_date) {
      setFormError(!parsedAmt.ok ? parsedAmt.messageFa : 'تکمیل بیمار و سررسید الزامی است.');
      return;
    }
    setSaving(true);
    let finalNotes = form.notes || '';
    if (form.sayad_id.trim()) finalNotes = `[صیاد: ${form.sayad_id.trim()}] ${finalNotes}`.trim();
    const res = await supabase.from('checks').insert({
      patient_id: form.patient_id,
      check_number: form.check_number || null,
      bank_name: form.bank_name || null,
      amount: parsedAmt.amount,
      issue_date: form.issue_date,
      due_date: form.due_date,
      status: 'pending',
      is_guarantee: form.is_guarantee,
      type: form.is_guarantee ? 'guarantee' : 'collectible',
      notes: finalNotes || null,
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') {
      HapticEngine.error();
      return;
    }
    HapticEngine.success();
    setShowForm(false);
    setForm({ patient_id: '', check_number: '', sayad_id: '', bank_name: '', amount: '', issue_date: today, due_date: '', is_guarantee: false, notes: '' });
    refresh();
  };

  const setStatus = async (ch: Check, nextStatus: 'cleared' | 'bounced') => {
    const res = await clearOrBounceInstrumentCommand({ kind: 'check', record: ch, nextStatus });
    if (res.ok || res.resolution === 'queued') HapticEngine.success();
    else HapticEngine.error();
    refresh();
  };

  return (
    <>
      <div className="glass-card p-3" style={{ borderTop: '3px solid #F59E0B' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-500">چک‌های وصولی در جریان</p>
            <p className="text-xl font-black text-amber-600 tabular-nums">{fmtToman(stats.totalPendingCollectible)} ت</p>
            {stats.totalPendingGuarantee > 0 && (
              <p className="text-[10px] text-slate-500 mt-0.5">چک‌های ضمانت (جدا از وصولی): <b>{fmtToman(stats.totalPendingGuarantee)} ت</b></p>
            )}
          </div>
          <div className="text-left">
            <p className="text-[10px] text-gray-400">تعداد وصولی: <b className="text-gray-700">{stats.count.toLocaleString('fa-IR')}</b></p>
            {stats.overdue > 0 && <p className="text-[10px] text-red-500">{stats.overdue} سررسید گذشته</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">چک‌های صیادی و ضمانت</span>
        <div className="flex items-center gap-2">
          <button onClick={handleExportChecks} className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow"><FileSpreadsheet size={15} /></button>
          <button onClick={() => setShowForm(true)} className="px-3 h-8 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-1 shadow"><Plus size={16} /> چک جدید</button>
        </div>
      </div>

      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت چک جدید" icon={<FileCheck size={20} />} color="#F59E0B">
        <div className="space-y-3.5">
          <Field label="بیمار"><Select value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} options={[{ value: '', label: 'انتخاب...' }, ...patients.map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}` }))]} /></Field>
          <Field label="کاربری چک">
            <Select
              value={form.is_guarantee ? 'guarantee' : 'collectible'}
              onChange={(e) => setForm({ ...form, is_guarantee: e.target.value === 'guarantee' })}
              options={[
                { value: 'collectible', label: 'چک وصولی (قابل کسر از بدهی پس از پاس شدن)' },
                { value: 'guarantee', label: 'چک ضمانت (وثیقه نزد مطب — خارج از درآمد نقدی)' },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="شماره چک"><Input value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} /></Field>
            <Field label="شناسه صیادی (۱۶ رقم)"><Input value={form.sayad_id} maxLength={16} onChange={(e) => setForm({ ...form, sayad_id: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="بانک"><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></Field>
            <Field label="مبلغ (تومان)"><Input type="text" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="۵۰۰۰۰۰۰" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="تاریخ صدور"><JalaliDatePicker value={form.issue_date} onChange={(v) => setForm({ ...form, issue_date: v })} /></Field>
            <Field label="تاریخ سررسید"><JalaliDatePicker value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} /></Field>
          </div>
          {formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}
          <Button color="#F59E0B" disabled={saving || !form.patient_id || !form.amount || !form.due_date} className="w-full" onClick={save}>{saving ? 'در حال ثبت...' : 'ثبت چک'}</Button>
        </div>
      </Sheet>

      {checks.length === 0 ? (
        <EmptyState icon={<FileCheck size={28} />} title="چکی ثبت نشده" color="#F59E0B" />
      ) : (
        <div className="space-y-2 stagger">
          {checks.map((ch) => {
            const p = getPatient(ch.patient_id);
            const status = CHECK_STATUS[ch.status] ?? CHECK_STATUS.pending;
            const guarantee = isGuaranteeCheck(ch);
            return (
              <div key={ch.id} className="glass-card p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <p className="text-sm font-bold text-gray-800">{p ? `${p.first_name} ${p.last_name}` : 'نامشخص'}</p>
                    <p className="text-[10px] text-gray-400">چک #{ch.check_number || '-'} • سررسید: {toJalaliStr(ch.due_date)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {guarantee && <Badge color="#475569" bg="#E2E8F0">ضمانت</Badge>}
                    <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-amber-600 tabular-nums">{fmtToman(Number(ch.amount))} ت</span>
                  {ch.status === 'pending' && (
                    <div className="flex gap-1.5">
                      <button onClick={() => setStatus(ch, 'cleared')} className="px-2.5 py-1 rounded-lg bg-green-50 text-green-700 text-[11px] font-bold flex items-center gap-1"><CheckCircle2 size={12} /> {guarantee ? 'ابطال/عودت ضمانت' : 'وصول'}</button>
                      <button onClick={() => setStatus(ch, 'bounced')} className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 text-[11px] font-bold flex items-center gap-1"><XCircle size={12} /> برگشت</button>
                      <button onClick={() => setDeleteId(ch.id)} className="px-2 py-1 rounded-lg bg-gray-50 text-gray-400"><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={async () => { if (deleteId) await supabase.from('checks').delete().eq('id', deleteId); setDeleteId(null); refresh(); }} title="حذف چک" message="آیا مطمئن هستید؟" confirmLabel="حذف" />
    </>
  );
}

export function FinanceSaftehTab({
  safteh,
  patients,
  refresh,
}: {
  safteh: Safteh[];
  patients: Patient[];
  refresh: () => void;
}) {
  const today = todayGregorian();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ patient_id: '', safteh_number: '', amount: '', issue_date: today, due_date: '', guarantor_name: '', guarantor_national_id: '', notes: '' });

  const save = async () => {
    setFormError(null);
    const parsedAmt = parseExactTomanAmount(form.amount, { allowZero: false });
    if (!form.patient_id || !parsedAmt.ok || !form.due_date) {
      setFormError(!parsedAmt.ok ? parsedAmt.messageFa : 'اطلاعات ناقص است.');
      return;
    }
    setSaving(true);
    await supabase.from('safteh').insert({
      patient_id: form.patient_id,
      safteh_number: form.safteh_number || null,
      amount: parsedAmt.amount,
      issue_date: form.issue_date,
      due_date: form.due_date,
      guarantor_name: form.guarantor_name || null,
      guarantor_national_id: form.guarantor_national_id || null,
      status: 'pending',
      notes: form.notes || null,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ patient_id: '', safteh_number: '', amount: '', issue_date: today, due_date: '', guarantor_name: '', guarantor_national_id: '', notes: '' });
    refresh();
  };

  return (
    <>
      <div className="glass-card p-3 flex items-center justify-between" style={{ borderTop: '3px solid #6366F1' }}>
        <div>
          <p className="text-[11px] text-gray-500">سفته‌های ضمانت نزد مطب (غیرنقدی)</p>
          <p className="text-xl font-black text-indigo-600 tabular-nums">{fmtToman(safteh.filter((s) => s.status === 'pending').reduce((a, b) => a + Number(b.amount), 0))} ت</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-3 h-8 rounded-xl bg-indigo-500 text-white text-xs font-bold flex items-center gap-1"><Plus size={15} /> سفته جدید</button>
      </div>

      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت سفته ضمانت" icon={<ScrollText size={20} />} color="#6366F1">
        <div className="space-y-3">
          <Field label="بیمار"><Select value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} options={[{ value: '', label: 'انتخاب...' }, ...patients.map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}` }))]} /></Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="شماره سفته"><Input value={form.safteh_number} onChange={(e) => setForm({ ...form, safteh_number: e.target.value })} /></Field>
            <Field label="مبلغ (تومان)"><Input type="text" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          </div>
          <Field label="سررسید"><JalaliDatePicker value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} /></Field>
          <Field label="نام ضامن"><Input value={form.guarantor_name} onChange={(e) => setForm({ ...form, guarantor_name: e.target.value })} /></Field>
          {formError && <p className="text-xs font-bold text-rose-600">{formError}</p>}
          <Button color="#6366F1" disabled={saving} className="w-full" onClick={save}>{saving ? 'در حال ثبت...' : 'ثبت سفته'}</Button>
        </div>
      </Sheet>

      {safteh.length === 0 ? (
        <EmptyState icon={<ScrollText size={28} />} title="سفته‌ای ثبت نشده" color="#6366F1" />
      ) : (
        <div className="space-y-2 stagger">
          {safteh.map((sf) => {
            const p = patients.find((pt) => pt.id === sf.patient_id);
            const st = CHECK_STATUS[sf.status] ?? CHECK_STATUS.pending;
            return (
              <div key={sf.id} className="glass-card p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-bold text-gray-800">{p ? `${p.first_name} ${p.last_name}` : 'نامشخص'}</p>
                  <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
                </div>
                {sf.guarantor_name && <p className="text-[10px] text-gray-500 flex items-center gap-1"><User size={10} /> ضامن: {sf.guarantor_name}</p>}
                <div className="flex items-center justify-between mt-1.5">
                  <span className="font-black text-indigo-600 tabular-nums">{fmtToman(Number(sf.amount))} ت</span>
                  {sf.status === 'pending' && (
                    <button
                      onClick={async () => {
                        await clearOrBounceInstrumentCommand({ kind: 'safteh', record: sf, nextStatus: 'cleared' });
                        refresh();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-green-50 text-green-700 text-[11px] font-bold"
                    >
                      تسویه ضمانت
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
