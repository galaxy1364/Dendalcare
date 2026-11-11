import { useState, useMemo } from 'react';
import { FlaskConical, Plus, Search, Send, PackageCheck, ArrowLeftRight, Clock, Building2 } from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { supabase, type LabOrder, type Patient } from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState, Loading } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { ClinicDefinitionsModal } from '@/components/ui/ClinicDefinitionsModal';
import { loadLaboratories } from '@/lib/clinicDefinitions';

const WORK_TYPES = [
  { value: 'crown', label: 'روکش' },
  { value: 'bridge', label: 'پل' },
  { value: 'denture', label: 'دنچر' },
  { value: 'implant_abutment', label: 'اباتمان ایمپلنت' },
  { value: 'orthodontic_appliance', label: 'اپلاینس ارتودنسی' },
  { value: 'splint', label: 'اسپلینت' },
  { value: 'other', label: 'سایر' },
];

const VITA_SHADES = [
  'A1', 'A2', 'A3', 'A3.5', 'A4',
  'B1', 'B2', 'B3', 'B4',
  'C1', 'C2', 'C3', 'C4',
  'D2', 'D3', 'D4',
  'BL1', 'BL2', 'BL3', 'BL4',
];

const LAB_MATERIALS = [
  'زیرکونیا مونولیتیک',
  'زیرکونیا لایه‌ای (ML)',
  'ایمکس (E.max CAD)',
  'پرسلن متال (PFM)',
  'پست و کور ریختگی',
  'روکش موقت PMMA',
  'نایت‌گارد و اسپلینت',
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  sent: { label: 'ارسال‌شده', color: '#3B82F6', bg: '#DBEAFE' },
  in_progress: { label: 'در حال ساخت', color: '#F59E0B', bg: '#FEF3C7' },
  received: { label: 'دریافت‌شده', color: '#22C55E', bg: '#DCFCE7' },
  delivered_to_patient: { label: 'تحویل بیمار', color: '#8B5CF6', bg: '#EDE9FE' },
  cancelled: { label: 'لغوشده', color: '#EF4444', bg: '#FEE2E2' },
};

export function Lab() {
  const { data: labOrders, loading, refresh } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: patients } = useRealtimeTable<Patient>('patients');

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [defsModalOpen, setDefsModalOpen] = useState(false);
  const [editing, setEditing] = useState<LabOrder | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = labOrders;
    if (filter !== 'all') list = list.filter(l => l.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(l => {
        const patient = patients.find(p => p.id === l.patient_id);
        return (patient && `${patient.first_name} ${patient.last_name}`.toLowerCase().includes(q)) ||
          l.lab_name?.toLowerCase().includes(q) ||
          l.tooth_numbers?.toLowerCase().includes(q);
      });
    }
    return list;
  }, [labOrders, patients, search, filter]);

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  const handleSave = async (data: Partial<LabOrder>): Promise<boolean> => {
    setSaving(true);
    const result = editing
      ? await supabase.from('lab_orders').update(data).eq('id', editing.id)
      : await supabase.from('lab_orders').insert(data);
    setSaving(false);
    if (result.error) return false;
    setSheetOpen(false);
    setEditing(null);
    setActionError(null);
    refresh();
    return true;
  };

  const handleStatusChange = async (id: string, status: string) => {
    const update: Record<string, unknown> = { status };
    if (status === 'received') update.received_date = todayGregorian();
    const { error } = await supabase.from('lab_orders').update(update).eq('id', id);
    if (error) {
      setActionError('تغییر وضعیت انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('lab_orders').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      setActionError('حذف انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  if (loading) return <Loading color="#EC4899" />;

  const LAB_STAGES_ORDER = [
    { key: 'sent', label: 'ارسال قالب', color: '#3B82F6' },
    { key: 'in_progress', label: 'ساخت لابراتوار', color: '#F59E0B' },
    { key: 'received', label: 'دریافت در مطب', color: '#22C55E' },
    { key: 'delivered_to_patient', label: 'تحویل بیمار', color: '#8B5CF6' },
  ];

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* ── QBank Sliding Horizontal Chip Bar + Expandable Magnifier Search ── */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen || search
                ? 'bg-pink-600 text-white shadow-md shadow-pink-600/30'
                : 'bg-pink-50 text-pink-700 hover:bg-pink-100'
            }`}
            title="جستجوی بیمار، لابراتوار یا دندان"
            aria-label="جستجوی لابراتوار"
          >
            <Search size={17} />
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {[
              { v: 'all', l: 'همه سفارشات', c: labOrders.length, color: '#DB2777' },
              { v: 'sent', l: 'ارسالی', c: labOrders.filter(l => l.status === 'sent').length, color: '#2563EB' },
              { v: 'in_progress', l: 'در حال ساخت', c: labOrders.filter(l => l.status === 'in_progress').length, color: '#D97706' },
              { v: 'received', l: 'دریافتی', c: labOrders.filter(l => l.status === 'received').length, color: '#059669' },
              { v: 'delivered_to_patient', l: 'تحویل بیمار', c: labOrders.filter(l => l.status === 'delivered_to_patient').length, color: '#7C3AED' },
            ].map(f => {
              const active = filter === f.v;
              return (
                <button
                  key={f.v}
                  onClick={() => setFilter(f.v)}
                  className={`px-3 py-1.5 rounded-2xl text-[11px] font-extrabold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 haptic ${
                    active ? 'text-white shadow-md scale-[1.02]' : 'bg-gray-100/90 text-gray-600'
                  }`}
                  style={active ? { background: f.color } : undefined}
                >
                  <span>{f.l}</span>
                  <span className={`text-[9.5px] px-1.5 rounded-full ${active ? 'bg-white/25 text-white' : 'bg-white text-gray-500'}`}>
                    {f.c.toLocaleString('fa-IR')}
                  </span>
                </button>
              );
            })}

            <button
              onClick={() => setDefsModalOpen(true)}
              className="px-3 py-1.5 rounded-2xl bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-extrabold whitespace-nowrap flex items-center gap-1 shrink-0 haptic"
              title="تعریف لابراتوارهای ثابت و متحرک"
            >
              <Building2 size={13} />
              <span>لیست لابراتوارها (ثابت/متحرک)</span>
            </button>
          </div>

          <button
            onClick={() => { setEditing(null); setSheetOpen(true); }}
            className="w-9 h-9 rounded-2xl bg-pink-500 hover:bg-pink-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            aria-label="سفارش لابراتوار جدید"
          >
            <Plus size={20} />
          </button>
        </div>

        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-pink-600" />
              <Input
                autoFocus
                placeholder="جستجوی نام بیمار، نام لابراتوار یا شماره دندان..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState icon={<FlaskConical size={28} />} title="سفارش لابراتواری یافت نشد" color="#EC4899" />
      ) : (
        <div className="space-y-2.5 stagger">
          {filtered.map(order => {
            const patient = getPatient(order.patient_id);
            const status = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.sent;
            const workType = WORK_TYPES.find(w => w.value === order.work_type)?.label ?? order.work_type;
            const currentStageIndex = LAB_STAGES_ORDER.findIndex(s => s.key === order.status);
            const isExpanded = expandedId === order.id;

            return (
              <div key={order.id} className="glass-card p-3.5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div
                    onClick={() => { setEditing(order); setSheetOpen(true); }}
                    className="flex items-center gap-2.5 cursor-pointer min-w-0 flex-1"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center text-white shrink-0 shadow-sm">
                      <FlaskConical size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800 truncate">
                        {patient ? `${patient.first_name} ${patient.last_name}` : 'بیمار نامشخص'}
                      </p>
                      <p className="text-[10.5px] font-bold text-pink-600 truncate">
                        {order.lab_name ?? 'لابراتوار تخصصی'} • پزشک: دکتر مهدی امیری
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : order.id)}
                      className="text-[10px] font-extrabold text-pink-600 mt-1"
                    >
                      {isExpanded ? 'بستن جزئیات ▲' : 'جزئیات کامل ▼'}
                    </button>
                  </div>
                </div>

                {/* Vital Specs Row on Patient Lab Card */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-700 mb-2.5">
                  <span className="px-2 py-0.5 rounded-lg bg-pink-50 text-pink-700 font-extrabold">
                    {workType}
                  </span>
                  {order.tooth_numbers && (
                    <span className="px-2 py-0.5 rounded-lg bg-violet-50 text-violet-700 font-extrabold">
                      دندان: {order.tooth_numbers}
                    </span>
                  )}
                  {order.shade && (
                    <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 font-bold">
                      رنگ: {order.shade}
                    </span>
                  )}
                  {order.material && (
                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold">
                      {order.material}
                    </span>
                  )}
                </div>

                {/* Live Interactive 4-Stage Progress Stepper (Click any stage to update immediately) */}
                <div className="grid grid-cols-4 gap-1 mb-2.5">
                  {LAB_STAGES_ORDER.map((stg, idx) => {
                    const isDone = currentStageIndex >= idx;
                    const isCurrent = currentStageIndex === idx;
                    return (
                      <button
                        key={stg.key}
                        onClick={() => handleStatusChange(order.id, stg.key)}
                        className="rounded-xl py-1.5 px-1 text-center transition-all haptic"
                        style={{
                          background: isCurrent ? stg.color : isDone ? `${stg.color}18` : '#F1F5F9',
                          color: isCurrent ? '#FFFFFF' : isDone ? stg.color : '#94A3B8',
                          border: isCurrent ? `1px solid ${stg.color}` : '1px solid transparent',
                        }}
                        title={`تغییر مرحله به: ${stg.label}`}
                      >
                        <span className="text-[9.5px] font-extrabold block truncate">
                          {idx + 1}. {stg.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
                  <span className="text-gray-500 flex items-center gap-1 text-[11px] font-semibold">
                    <Send size={11} className="text-blue-500" /> ارسال: {toJalaliStr(order.sent_date)}
                  </span>
                  {order.due_date && (
                    <span className="text-amber-600 flex items-center gap-1 text-[11px] font-bold">
                      <Clock size={11} /> تحویل: {toJalaliStr(order.due_date)}
                    </span>
                  )}
                  {Number(order.cost) > 0 && (
                    <span className="font-black text-pink-600">{Number(order.cost).toLocaleString('fa-IR')} ت</span>
                  )}
                </div>

                {isExpanded && (
                  <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200 space-y-2 animate-fade-in">
                    {order.notes && (
                      <p className="text-xs text-gray-600 bg-gray-50 rounded-xl p-2">{order.notes}</p>
                    )}
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { setEditing(order); setSheetOpen(true); }}
                        className="flex-1 py-1.5 rounded-xl bg-pink-50 text-pink-700 text-xs font-extrabold haptic"
                      >
                        ویرایش کامل سفارش
                      </button>
                      <button
                        onClick={() => setDeleteId(order.id)}
                        className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 text-xs font-extrabold haptic"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {actionError && <p className="text-xs text-red-500 bg-red-50 rounded-xl p-2.5">{actionError}</p>}
      <Sheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
        title={editing ? 'ویرایش کار لابراتوار' : 'کار لابراتوار جدید'}
        icon={<FlaskConical size={20} />}
        color="#EC4899"
      >
        <LabForm treatment={editing} patients={patients} onSave={handleSave} saving={saving} />
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف کار لابراتوار"
        message="آیا از حذف این کار لابراتوار اطمینان دارید؟"
        confirmLabel="حذف"
      />

      <ClinicDefinitionsModal
        open={defsModalOpen}
        onClose={() => setDefsModalOpen(false)}
        defaultTab="labs"
      />
    </div>
  );
}

function LabForm({ treatment, patients, onSave, saving }: {
  treatment: LabOrder | null;
  patients: Patient[];
  onSave: (d: Partial<LabOrder>) => Promise<boolean>;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    patient_id: treatment?.patient_id ?? '',
    lab_name: treatment?.lab_name ?? '',
    work_type: treatment?.work_type ?? 'crown',
    tooth_numbers: treatment?.tooth_numbers ?? '',
    shade: treatment?.shade ?? '',
    material: treatment?.material ?? '',
    status: treatment?.status ?? 'sent',
    sent_date: treatment?.sent_date ?? todayGregorian(),
    due_date: treatment?.due_date ?? '',
    received_date: treatment?.received_date ?? '',
    cost: treatment?.cost ?? 0,
    notes: treatment?.notes ?? '',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const submit = async () => {
    if (!form.patient_id) {
      setFormError('لطفاً بیمار را انتخاب کنید.');
      return;
    }
    setFormError(null);
    const ok = await onSave({
      ...form,
      patient_id: form.patient_id || null,
      lab_name: form.lab_name.trim() || null,
      tooth_numbers: form.tooth_numbers.trim() || null,
      cost: Number(form.cost),
      due_date: form.due_date || null,
      received_date: form.received_date || null,
    });
    if (!ok) setFormError('ذخیره انجام نشد. لطفاً دوباره تلاش کنید.');
  };

  return (
    <div className="space-y-4">
      <Field label="بیمار">
        <Select
          value={form.patient_id}
          onChange={e => setForm({ ...form, patient_id: e.target.value })}
          options={[
            { value: '', label: 'انتخاب بیمار...' },
            ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` })),
          ]}
        />
      </Field>
      <div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="نام لابراتوار"><Input value={form.lab_name} onChange={e => setForm({ ...form, lab_name: e.target.value })} placeholder="نام لابراتوار" /></Field>
          <Field label="نوع کار">
            <Select value={form.work_type} onChange={e => setForm({ ...form, work_type: e.target.value })} options={WORK_TYPES} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {loadLaboratories().map(l => (
            <button
              type="button"
              key={l.id}
              onClick={() => setForm(prev => ({ ...prev, lab_name: l.name }))}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                form.lab_name === l.name ? 'bg-pink-600 text-white border-pink-600' : 'bg-pink-50 text-pink-700 border-pink-200'
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>
      <Field label="شماره دندان‌ها"><Input value={form.tooth_numbers} onChange={e => setForm({ ...form, tooth_numbers: e.target.value })} placeholder="مثلاً ۱۱، ۲۱ (FDI) یا ۱ و ۲ بالا" /></Field>
      <div>
        <Field label="رنگ دندان (Vita Shade)"><Input value={form.shade} onChange={e => setForm({ ...form, shade: e.target.value })} placeholder="مثلاً A2 یا BL2" /></Field>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {VITA_SHADES.map(s => (
            <button
              type="button"
              key={s}
              onClick={() => setForm(prev => ({ ...prev, shade: s }))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all ${form.shade === s ? 'bg-pink-600 text-white border-pink-600' : 'bg-gray-50 text-gray-700 border-gray-200'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Field label="جنس و متریال"><Input value={form.material} onChange={e => setForm({ ...form, material: e.target.value })} placeholder="مثلاً زیرکونیا" /></Field>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {LAB_MATERIALS.map(m => (
            <button
              type="button"
              key={m}
              onClick={() => setForm(prev => ({ ...prev, material: m }))}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-all ${form.material === m ? 'bg-pink-600 text-white border-pink-600' : 'bg-gray-50 text-gray-700 border-gray-200'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ ارسال"><JalaliDatePicker value={form.sent_date} onChange={v => setForm({ ...form, sent_date: v })} /></Field>
        <Field label="موعد تحویل"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="هزینه (تومان)"><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: Number(e.target.value) })} /></Field>
        <Field label="وضعیت">
          <Select
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value })}
            options={[
              { value: 'sent', label: 'ارسال‌شده' },
              { value: 'in_progress', label: 'در حال ساخت' },
              { value: 'received', label: 'دریافت‌شده' },
              { value: 'delivered_to_patient', label: 'تحویل بیمار' },
              { value: 'cancelled', label: 'لغوشده' },
            ]}
          />
        </Field>
      </div>
      <Field label="یادداشت"><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="یادداشت..." /></Field>
      {formError && <p className="text-xs text-red-500 px-1">{formError}</p>}
      <Button onClick={submit} color="#EC4899" disabled={saving} className="w-full">
        {saving ? 'در حال ذخیره...' : 'ذخیره'}
      </Button>
    </div>
  );
}
