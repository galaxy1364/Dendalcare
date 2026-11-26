import { useState } from 'react';
import {
  Calendar, Clock, FlaskConical, Anchor, BellRing, CheckCircle2,
} from 'lucide-react';
import {
  supabase,
  type LabOrder, type Implant, type Reminder,
} from '@/lib/supabase';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Select, Button, Badge } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { SectionHeader, EmptyHint, DeleteBtn } from './PatientClinicalTabs';

export const LAB_WORK_TYPES = [
  { value: 'crown', label: 'روکش' },
  { value: 'bridge', label: 'پل' },
  { value: 'denture', label: 'دنچر' },
  { value: 'implant_abutment', label: 'اباتمان ایمپلنت' },
  { value: 'orthodontic_appliance', label: 'اپلاینس ارتودنسی' },
  { value: 'splint', label: 'اسپلینت' },
  { value: 'other', label: 'سایر' },
];

export const IMPLANT_STAGES = [
  { value: 'planning', label: 'برنامه‌ریزی' },
  { value: 'extraction_and_graft', label: 'کشیدن و پیوند' },
  { value: 'implant_placement', label: 'جایگذاری ایمپلنت' },
  { value: 'osseointegration', label: 'ادغام استخوان' },
  { value: 'abutment_placement', label: 'قرارگیری اباتمان' },
  { value: 'crown_fitting', label: 'نصب روکش' },
  { value: 'completed', label: 'تکمیل‌شده' },
  { value: 'failed', label: 'ناموفق' },
];

export const REMINDER_CATEGORIES = [
  { value: 'appointment', label: 'نوبت' },
  { value: 'treatment', label: 'درمان' },
  { value: 'lab', label: 'لابراتوار' },
  { value: 'implant', label: 'ایمپلنت' },
  { value: 'payment', label: 'پرداخت' },
  { value: 'follow_up', label: 'ویزیت مجدد' },
  { value: 'other', label: 'سایر' },
];

export const REMINDER_PRIORITIES = [
  { value: 'low', label: 'کم' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'زیاد' },
  { value: 'urgent', label: 'فوری' },
];

export const LAB_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  sent: { label: 'ارسال‌شده', color: '#3B82F6', bg: '#DBEAFE' },
  in_progress: { label: 'در حال ساخت', color: '#F59E0B', bg: '#FEF3C7' },
  received: { label: 'دریافت‌شده', color: '#22C55E', bg: '#DCFCE7' },
  delivered_to_patient: { label: 'تحویل بیمار', color: '#8B5CF6', bg: '#EDE9FE' },
  cancelled: { label: 'لغوشده', color: '#EF4444', bg: '#FEE2E2' },
};

export function LabTab({ patientId, labOrders }: { patientId: string; labOrders: LabOrder[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ lab_name: '', work_type: 'crown', tooth_numbers: '', shade: '', material: '', due_date: '', cost: '', notes: '' });

  const save = async () => {
    setSaving(true);
    const res = await supabase.from('lab_orders').insert({
      patient_id: patientId, lab_name: form.lab_name || null,
      work_type: form.work_type, tooth_numbers: form.tooth_numbers || null,
      shade: form.shade || null, material: form.material || null,
      status: 'sent', sent_date: todayGregorian(),
      due_date: form.due_date || null, cost: Number(form.cost) || 0,
      notes: form.notes || null,
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') return;
    setShowForm(false);
    setForm({ lab_name: '', work_type: 'crown', tooth_numbers: '', shade: '', material: '', due_date: '', cost: '', notes: '' });
  };

  const updateStatus = async (id: string, status: string) => {
    const update: Record<string, unknown> = { status };
    if (status === 'received') update.received_date = todayGregorian();
    await supabase.from('lab_orders').update(update).eq('id', id);
  };
  const del = async (id: string) => { await supabase.from('lab_orders').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="کار لابراتوار" count={labOrders.length} onAdd={() => setShowForm(true)} color="#EC4899" icon={<FlaskConical size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ارسال سفارش جدید به لابراتوار" icon={<FlaskConical size={20} />} color="#EC4899">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="نام لابراتوار"><Input value={form.lab_name} onChange={e => setForm({ ...form, lab_name: e.target.value })} placeholder="نام لابراتوار" /></Field>
            <Field label="نوع کار"><Select value={form.work_type} onChange={e => setForm({ ...form, work_type: e.target.value })} options={LAB_WORK_TYPES} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="دندان‌ها"><Input value={form.tooth_numbers} onChange={e => setForm({ ...form, tooth_numbers: e.target.value })} placeholder="شماره دندان‌ها" /></Field>
            <Field label="رنگ"><Input value={form.shade} onChange={e => setForm({ ...form, shade: e.target.value })} placeholder="مثلاً A2" /></Field>
          </div>
          <Field label="متریال"><Input value={form.material} onChange={e => setForm({ ...form, material: e.target.value })} placeholder="مثلاً زیرکونیا" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="موعد تحویل"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
            <Field label="هزینه"><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="هزینه" /></Field>
          </div>
          <Button color="#EC4899" disabled={saving} className="w-full" onClick={save}>{saving ? 'در حال ارسال...' : 'ارسال به لابراتوار'}</Button>
        </div>
      </Sheet>
      {labOrders.length === 0 ? <EmptyHint text="کاری برای لابراتوار ارسال نشده" /> : labOrders.map(l => {
        const status = LAB_STATUS[l.status] ?? LAB_STATUS.sent;
        const workType = LAB_WORK_TYPES.find(w => w.value === l.work_type)?.label ?? l.work_type;
        return (
          <div key={l.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">{workType} — {l.lab_name ?? 'لابراتوار'}</p>
              <div className="flex items-center gap-2">
                <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                <DeleteBtn onClick={() => del(l.id)} />
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {l.tooth_numbers && <span>دندان: {l.tooth_numbers}</span>}
              {l.shade && <span>رنگ: {l.shade}</span>}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">ارسال: {toJalaliStr(l.sent_date)}</span>
              {l.due_date && <span className="text-xs text-amber-500">موعد: {toJalaliStr(l.due_date)}</span>}
              {Number(l.cost) > 0 && <span className="text-xs font-bold text-pink-600">{Number(l.cost).toLocaleString('fa-IR')} ت</span>}
            </div>
            {(l.status === 'sent' || l.status === 'in_progress') && (
              <div className="flex gap-1.5 mt-2">
                {l.status === 'sent' && <button onClick={() => updateStatus(l.id, 'in_progress')} className="flex-1 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-xs font-semibold haptic">در حال ساخت</button>}
                <button onClick={() => updateStatus(l.id, 'received')} className="flex-1 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic">دریافت شد</button>
              </div>
            )}
            {l.status === 'received' && (
              <button onClick={() => updateStatus(l.id, 'delivered_to_patient')} className="w-full mt-2 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-xs font-semibold haptic">تحویل به بیمار</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ImplantsTab({ patientId, implants }: { patientId: string; implants: Implant[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ tooth_number: '', brand: '', implant_size: '', cost: '', notes: '' });

  const save = async () => {
    setSaving(true);
    const res = await supabase.from('implants').insert({
      patient_id: patientId, tooth_number: form.tooth_number ? Number(form.tooth_number) : null,
      brand: form.brand || null, implant_size: form.implant_size || null,
      stage: 'planning', cost: Number(form.cost) || 0, paid_amount: 0,
      notes: form.notes || null,
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') return;
    setShowForm(false);
    setForm({ tooth_number: '', brand: '', implant_size: '', cost: '', notes: '' });
  };

  const updateStage = async (id: string, stage: string) => {
    const update: Record<string, unknown> = { stage };
    const today = todayGregorian();
    if (stage === 'implant_placement') update.placement_date = today;
    if (stage === 'osseointegration') update.osseointegration_date = today;
    if (stage === 'abutment_placement') update.abutment_date = today;
    if (stage === 'crown_fitting') update.crown_date = today;
    if (stage === 'completed') update.completion_date = today;
    await supabase.from('implants').update(update).eq('id', id);
  };
  const del = async (id: string) => { await supabase.from('implants').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="ایمپلنت‌ها" count={implants.length} onAdd={() => setShowForm(true)} color="#06B6D4" icon={<Anchor size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت ایمپلنت جدید برای بیمار" icon={<Anchor size={20} />} color="#06B6D4">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="شماره دندان (FDI)"><Input type="number" value={form.tooth_number} onChange={e => setForm({ ...form, tooth_number: e.target.value })} placeholder="مثلاً ۳۶" /></Field>
            <Field label="برند"><Input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="مثلاً Straumann" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="سایز"><Input value={form.implant_size} onChange={e => setForm({ ...form, implant_size: e.target.value })} placeholder="مثلاً 4.1x10mm" /></Field>
            <Field label="هزینه"><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="هزینه" /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          <Button color="#06B6D4" disabled={saving} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت ایمپلنت'}</Button>
        </div>
      </Sheet>
      {implants.length === 0 ? <EmptyHint text="ایمپلنتی ثبت نشده" /> : implants.map(imp => {
        const stageInfo = IMPLANT_STAGES.find(s => s.value === imp.stage) ?? IMPLANT_STAGES[0];
        const stageIdx = IMPLANT_STAGES.findIndex(s => s.value === imp.stage);
        const remaining = Number(imp.cost) - Number(imp.paid_amount);
        return (
          <div key={imp.id} className="glass-card p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">ایمپلنت دندان {imp.tooth_number ?? '-'}</p>
              <div className="flex items-center gap-2">
                <Badge color="#06B6D4" bg="#CFFAFE">{stageInfo.label}</Badge>
                <DeleteBtn onClick={() => del(imp.id)} />
              </div>
            </div>
            {imp.brand && <p className="text-xs text-gray-400">{imp.brand} • {imp.implant_size}</p>}
            <div className="flex items-center gap-1 my-2">
              {IMPLANT_STAGES.slice(0, 7).map((s, i) => (
                <div key={s.value} className="flex items-center flex-1">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: i <= stageIdx ? '#06B6D4' : '#E5E7EB' }} />
                  {i < 6 && <div className="flex-1 h-0.5 rounded-full" style={{ background: i < stageIdx ? '#06B6D4' : '#E5E7EB' }} />}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100">
              <span className="font-bold text-cyan-600">{Number(imp.cost).toLocaleString('fa-IR')} ت</span>
              {remaining > 0 ? <span className="text-red-500">باقی: {remaining.toLocaleString('fa-IR')} ت</span> : <span className="text-green-500">تسویه</span>}
            </div>
            {imp.stage !== 'completed' && imp.stage !== 'failed' && (
              <Select className="mt-2 text-xs" value={imp.stage} onChange={e => updateStage(imp.id, e.target.value)} options={IMPLANT_STAGES} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RemindersTab({ patientId, reminders }: { patientId: string; reminders: Reminder[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', reminder_date: todayGregorian(), reminder_time: '09:00', category: 'follow_up', priority: 'medium' });

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const res = await supabase.from('reminders').insert({
      patient_id: patientId, title: form.title,
      description: form.description || null, reminder_date: form.reminder_date,
      reminder_time: form.reminder_time, category: form.category,
      priority: form.priority, status: 'pending',
    });
    setSaving(false);
    if (getMutationOutcome(res) === 'error') return;
    setShowForm(false);
    setForm({ title: '', description: '', reminder_date: todayGregorian(), reminder_time: '09:00', category: 'follow_up', priority: 'medium' });
  };
  const updateStatus = async (id: string, status: string) => { await supabase.from('reminders').update({ status }).eq('id', id); };
  const del = async (id: string) => { await supabase.from('reminders').delete().eq('id', id); };
  const PRIO: Record<string, { color: string; bg: string }> = {
    low: { color: '#9CA3AF', bg: '#F3F4F6' },
    medium: { color: '#F59E0B', bg: '#FEF3C7' },
    high: { color: '#F97316', bg: '#FFEDD5' },
    urgent: { color: '#EF4444', bg: '#FEE2E2' },
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <SectionHeader title="یادآوری‌ها" count={reminders.length} onAdd={() => setShowForm(true)} color="#EF4444" icon={<BellRing size={16} />} />
      <Sheet open={showForm} onClose={() => setShowForm(false)} title="ثبت یادآوری جدید برای بیمار" icon={<BellRing size={20} />} color="#EF4444">
        <div className="space-y-4">
          <Field label="عنوان"><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="عنوان یادآوری" /></Field>
          <Field label="شرح"><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="شرح..." /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاریخ"><JalaliDatePicker value={form.reminder_date} onChange={v => setForm({ ...form, reminder_date: v })} /></Field>
            <Field label="ساعت"><Input type="time" value={form.reminder_time} onChange={e => setForm({ ...form, reminder_time: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="بخش"><Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={REMINDER_CATEGORIES} /></Field>
            <Field label="اولویت"><Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} options={REMINDER_PRIORITIES} /></Field>
          </div>
          <Button color="#EF4444" disabled={saving || !form.title.trim()} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'ثبت یادآوری'}</Button>
        </div>
      </Sheet>
      {reminders.length === 0 ? <EmptyHint text="یادآوری‌ای ثبت نشده" /> : reminders.map(r => {
        const prio = PRIO[r.priority] ?? PRIO.medium;
        return (
          <div key={r.id} className="glass-card p-3" style={{ borderRight: r.status === 'pending' ? '3px solid #EF4444' : undefined }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-700">{r.title}</p>
              <div className="flex items-center gap-2">
                <Badge color={prio.color} bg={prio.bg}>{r.priority}</Badge>
                <DeleteBtn onClick={() => del(r.id)} />
              </div>
            </div>
            {r.description && <p className="text-xs text-gray-500">{r.description}</p>}
            <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
              <span className="flex items-center gap-1"><Calendar size={11} />{toJalaliStr(r.reminder_date)}</span>
              <span className="flex items-center gap-1"><Clock size={11} />{r.reminder_time.slice(0, 5)}</span>
            </div>
            {r.status === 'pending' && (
              <button onClick={() => updateStatus(r.id, 'done')} className="w-full mt-2 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-semibold haptic flex items-center justify-center gap-1">
                <CheckCircle2 size={14} /> انجام شد
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
