import { useState, useMemo } from 'react';
import { Anchor, Plus, Search, Calendar, DollarSign, CheckCircle2, CircleDot, Building2 } from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { supabase, type Implant, type Patient } from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState, Loading } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { ClinicDefinitionsModal } from '@/components/ui/ClinicDefinitionsModal';
import { loadImplantBrands } from '@/lib/clinicDefinitions';

const STAGES = [
  { value: 'planning', label: 'برنامه‌ریزی', icon: '📋' },
  { value: 'extraction_and_graft', label: 'کشیدن و پیوند', icon: '🦷' },
  { value: 'implant_placement', label: 'جایگذاری ایمپلنت', icon: '⚙️' },
  { value: 'osseointegration', label: 'ادغام استخوان', icon: '🦴' },
  { value: 'abutment_placement', label: 'قرارگیری اباتمان', icon: '🔧' },
  { value: 'crown_fitting', label: 'نصب روکش', icon: '👑' },
  { value: 'completed', label: 'تکمیل‌شده', icon: '✅' },
  { value: 'failed', label: 'ناموفق', icon: '❌' },
];

const STAGE_CONFIG: Record<string, { color: string; bg: string }> = {
  planning: { color: '#3B82F6', bg: '#DBEAFE' },
  extraction_and_graft: { color: '#F59E0B', bg: '#FEF3C7' },
  implant_placement: { color: '#06B6D4', bg: '#CFFAFE' },
  osseointegration: { color: '#8B5CF6', bg: '#EDE9FE' },
  abutment_placement: { color: '#EC4899', bg: '#FCE7F3' },
  crown_fitting: { color: '#F97316', bg: '#FFEDD5' },
  completed: { color: '#22C55E', bg: '#DCFCE7' },
  failed: { color: '#EF4444', bg: '#FEE2E2' },
};

export function Implants() {
  const { data: implants, loading, refresh } = useRealtimeTable<Implant>('implants');
  const { data: patients } = useRealtimeTable<Patient>('patients');

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState<'all' | 'surgery' | 'healing' | 'abutment' | 'crown'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [defsModalOpen, setDefsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Implant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = implants;
    if (stageFilter === 'surgery') {
      list = list.filter(i => i.stage === 'planning' || i.stage === 'extraction_and_graft' || i.stage === 'implant_placement');
    } else if (stageFilter === 'healing') {
      list = list.filter(i => i.stage === 'osseointegration');
    } else if (stageFilter === 'abutment') {
      list = list.filter(i => i.stage === 'abutment_placement');
    } else if (stageFilter === 'crown') {
      list = list.filter(i => i.stage === 'crown_fitting' || i.stage === 'completed');
    }

    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(im => {
      const patient = patients.find(p => p.id === im.patient_id);
      return (
        (patient && `${patient.first_name} ${patient.last_name}`.toLowerCase().includes(q)) ||
        im.brand?.toLowerCase().includes(q) ||
        String(im.tooth_number ?? '').includes(q)
      );
    });
  }, [implants, patients, search, stageFilter]);

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  const handleSave = async (data: Partial<Implant>): Promise<boolean> => {
    setSaving(true);
    const result = editing
      ? await supabase.from('implants').update(data).eq('id', editing.id)
      : await supabase.from('implants').insert(data);
    setSaving(false);
    if (result.error) return false;
    setSheetOpen(false);
    setEditing(null);
    setActionError(null);
    refresh();
    return true;
  };

  const handleStageChange = async (id: string, stage: string) => {
    const update: Record<string, unknown> = { stage };
    const today = todayGregorian();
    if (stage === 'implant_placement') update.placement_date = today;
    if (stage === 'osseointegration') update.osseointegration_date = today;
    if (stage === 'abutment_placement') update.abutment_date = today;
    if (stage === 'crown_fitting') update.crown_date = today;
    const { error } = await supabase.from('implants').update(update).eq('id', id);
    if (error) {
      setActionError('تغییر مرحله انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('implants').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      setActionError('حذف انجام نشد. لطفاً دوباره تلاش کنید.');
      return;
    }
    setActionError(null);
    refresh();
  };

  if (loading) return <Loading color="#06B6D4" />;

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* ── QBank Sliding Horizontal Chip Bar + Expandable Magnifier Search ── */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen || search
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
            }`}
            title="جستجوی بیمار، برند فیکسچر یا دندان"
            aria-label="جستجوی ایمپلنت"
          >
            <Search size={17} />
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {[
              { id: 'all' as const, label: 'همه ایمپلنت‌ها', count: implants.length, color: '#0891B2' },
              {
                id: 'surgery' as const,
                label: 'جراحی و فیکسچر',
                count: implants.filter(i => i.stage === 'planning' || i.stage === 'extraction_and_graft' || i.stage === 'implant_placement').length,
                color: '#2563EB',
              },
              {
                id: 'healing' as const,
                label: 'هیلینگ و ادغام',
                count: implants.filter(i => i.stage === 'osseointegration').length,
                color: '#7C3AED',
              },
              {
                id: 'abutment' as const,
                label: 'قالب‌گیری و اباتمان',
                count: implants.filter(i => i.stage === 'abutment_placement').length,
                color: '#DB2777',
              },
              {
                id: 'crown' as const,
                label: 'روکش و تحویل',
                count: implants.filter(i => i.stage === 'crown_fitting' || i.stage === 'completed').length,
                color: '#059669',
              },
            ].map(ch => {
              const active = stageFilter === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => setStageFilter(ch.id)}
                  className={`px-3 py-1.5 rounded-2xl text-[11px] font-extrabold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 haptic ${
                    active ? 'text-white shadow-md scale-[1.02]' : 'bg-gray-100/90 text-gray-600'
                  }`}
                  style={active ? { background: ch.color } : undefined}
                >
                  <span>{ch.label}</span>
                  <span className={`text-[9.5px] px-1.5 rounded-full ${active ? 'bg-white/25 text-white' : 'bg-white text-gray-500'}`}>
                    {ch.count.toLocaleString('fa-IR')}
                  </span>
                </button>
              );
            })}

            <button
              onClick={() => setDefsModalOpen(true)}
              className="px-3 py-1.5 rounded-2xl bg-cyan-50 text-cyan-800 border border-cyan-200 text-[11px] font-extrabold whitespace-nowrap flex items-center gap-1 shrink-0 haptic"
              title="تعریف برندهای ایمپلنت"
            >
              <Building2 size={13} />
              <span>تعریف برندها</span>
            </button>
          </div>

          <button
            onClick={() => { setEditing(null); setSheetOpen(true); }}
            className="w-9 h-9 rounded-2xl bg-cyan-500 hover:bg-cyan-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            aria-label="ایمپلنت جدید"
          >
            <Plus size={20} />
          </button>
        </div>

        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-600" />
              <Input
                autoFocus
                placeholder="جستجوی نام بیمار، برند ایمپلنت یا شماره دندان..."
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
        <EmptyState icon={<Anchor size={28} />} title="پرونده ایمپلنتی یافت نشد" color="#06B6D4" />
      ) : (
        <div className="space-y-2.5 stagger">
          {filtered.map(im => {
            const patient = getPatient(im.patient_id);
            const stageInfo = STAGES.find(s => s.value === im.stage) ?? STAGES[0];
            const stageConf = STAGE_CONFIG[im.stage] ?? STAGE_CONFIG.planning;
            const currentStageIdx = STAGES.findIndex(s => s.value === im.stage);
            const balance = Number(im.cost) - Number(im.paid_amount);
            const isExpanded = expandedId === im.id;

            return (
              <div key={im.id} className="glass-card p-3.5">
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div
                    onClick={() => { setEditing(im); setSheetOpen(true); }}
                    className="flex items-center gap-2.5 cursor-pointer min-w-0 flex-1"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center text-white shrink-0 shadow-sm">
                      <Anchor size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800 truncate">
                        {patient ? `${patient.first_name} ${patient.last_name}` : 'بیمار نامشخص'}
                      </p>
                      <p className="text-[10.5px] font-bold text-cyan-700 truncate">
                        {im.brand ?? 'برند نامشخص'} {im.implant_size ? `(${im.implant_size})` : ''} • دندان {im.tooth_number ?? '-'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <Badge color={stageConf.color} bg={stageConf.bg}>{stageInfo.label}</Badge>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : im.id)}
                      className="text-[10px] font-extrabold text-cyan-700 mt-1"
                    >
                      {isExpanded ? 'بستن جزئیات ▲' : 'تاریخ‌ها و جزئیات ▼'}
                    </button>
                  </div>
                </div>

                {/* Interactive Clickable 7-Stage Progress Line (Tap any node to advance stage) */}
                <div className="flex items-center gap-1 mb-2.5 px-0.5">
                  {STAGES.slice(0, 7).map((s, idx) => {
                    const isDone = idx < currentStageIdx;
                    const isCurrent = idx === currentStageIdx;
                    return (
                      <div key={s.value} className="flex items-center flex-1">
                        <button
                          onClick={() => handleStageChange(im.id, s.value)}
                          title={`تغییر مرحله به: ${s.label}`}
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] shrink-0 transition-transform active:scale-90"
                          style={{
                            background: isDone ? '#22C55E' : isCurrent ? stageConf.color : '#E2E8F0',
                            color: isDone || isCurrent ? 'white' : '#64748B',
                            boxShadow: isCurrent ? `0 0 0 3px ${stageConf.color}30` : 'none',
                          }}
                        >
                          {isDone ? <CheckCircle2 size={12} /> : <span className="font-bold">{(idx + 1).toLocaleString('fa-IR')}</span>}
                        </button>
                        {idx < 6 && (
                          <div
                            className="flex-1 h-1 rounded-full mx-0.5"
                            style={{ background: idx < currentStageIdx ? '#22C55E' : '#E2E8F0' }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Dates Summary Row */}
                <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-600 mb-2">
                  {im.placement_date && (
                    <span className="bg-cyan-50 text-cyan-800 px-2 py-0.5 rounded-lg font-bold flex items-center gap-1">
                      <Calendar size={10} /> جراحی: {toJalaliStr(im.placement_date)}
                    </span>
                  )}
                  {im.osseointegration_date && (
                    <span className="bg-violet-50 text-violet-800 px-2 py-0.5 rounded-lg font-bold flex items-center gap-1">
                      <Calendar size={10} /> هیلینگ: {toJalaliStr(im.osseointegration_date)}
                    </span>
                  )}
                  {im.abutment_date && (
                    <span className="bg-pink-50 text-pink-800 px-2 py-0.5 rounded-lg font-bold flex items-center gap-1">
                      <Calendar size={10} /> قالب‌گیری: {toJalaliStr(im.abutment_date)}
                    </span>
                  )}
                  {im.crown_date && (
                    <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-lg font-bold flex items-center gap-1">
                      <Calendar size={10} /> تحویل روکش: {toJalaliStr(im.crown_date)}
                    </span>
                  )}
                </div>

                {/* Cost & Balance */}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100">
                  <span className="font-black text-cyan-700">{Number(im.cost).toLocaleString('fa-IR')} ت</span>
                  {balance > 0 ? (
                    <span className="text-rose-600 font-bold">مانده: {balance.toLocaleString('fa-IR')} ت</span>
                  ) : (
                    <span className="text-emerald-600 font-bold">تسویه کامل</span>
                  )}
                </div>

                {/* Collapsible Extended Technical Details & Stage Selector */}
                {isExpanded && (
                  <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200 space-y-2 animate-fade-in">
                    {(() => {
                      const torqueMatch = im.notes?.match(/تورک:\s*([0-9.]+)\s*N\.cm/i);
                      const isqMatch = im.notes?.match(/ISQ:\s*([0-9.]+)/i);
                      const lotMatch = im.notes?.match(/لات:\s*([A-Za-z0-9_-]+)/i);
                      if (!torqueMatch && !isqMatch && !lotMatch) return null;
                      return (
                        <div className="flex flex-wrap gap-1.5 text-[10px]">
                          {torqueMatch && <span className="bg-cyan-50 text-cyan-800 font-bold px-2 py-0.5 rounded-lg border border-cyan-200">تورک: {torqueMatch[1]} N.cm</span>}
                          {isqMatch && <span className="bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded-lg border border-emerald-200">ISQ: {isqMatch[1]}</span>}
                          {lotMatch && <span className="bg-gray-100 text-gray-700 font-mono px-2 py-0.5 rounded-lg border border-gray-200">LOT: {lotMatch[1]}</span>}
                        </div>
                      );
                    })()}

                    <div className="flex gap-1.5">
                      <Select
                        value={im.stage}
                        onChange={e => handleStageChange(im.id, e.target.value)}
                        options={STAGES.map(s => ({ value: s.value, label: s.label }))}
                        className="flex-1 text-xs py-1.5"
                      />
                      <button
                        onClick={() => { setEditing(im); setSheetOpen(true); }}
                        className="px-3 py-1.5 rounded-xl bg-cyan-50 text-cyan-700 text-xs font-extrabold haptic"
                      >
                        ویرایش
                      </button>
                      <button
                        onClick={() => setDeleteId(im.id)}
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
        title={editing ? 'ویرایش ایمپلنت' : 'ایمپلنت جدید'}
        icon={<Anchor size={20} />}
        color="#06B6D4"
      >
        <ImplantForm implant={editing} patients={patients} onSave={handleSave} saving={saving} />
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف ایمپلنت"
        message="آیا از حذف این ایمپلنت اطمینان دارید؟"
        confirmLabel="حذف"
      />

      <ClinicDefinitionsModal
        open={defsModalOpen}
        onClose={() => setDefsModalOpen(false)}
        defaultTab="implants"
      />
    </div>
  );
}

function ImplantForm({ implant, patients, onSave, saving }: {
  implant: Implant | null;
  patients: Patient[];
  onSave: (d: Partial<Implant>) => Promise<boolean>;
  saving: boolean;
}) {
  const initTorque = implant?.notes?.match(/تورک:\s*([0-9.]+)\s*N\.cm/i)?.[1] || '';
  const initIsq = implant?.notes?.match(/ISQ:\s*([0-9.]+)/i)?.[1] || '';
  const initLot = implant?.notes?.match(/لات:\s*([A-Za-z0-9_-]+)/i)?.[1] || '';
  const cleanNotes = (implant?.notes || '')
    .replace(/\[تورک:.*?\]/g, '')
    .replace(/\[ISQ:.*?\]/g, '')
    .replace(/\[لات:.*?\]/g, '')
    .trim();

  const [form, setForm] = useState({
    patient_id: implant?.patient_id ?? '',
    tooth_number: implant?.tooth_number ?? '',
    brand: implant?.brand ?? '',
    implant_size: implant?.implant_size ?? '',
    stage: implant?.stage ?? 'planning',
    placement_date: implant?.placement_date ?? '',
    osseointegration_date: implant?.osseointegration_date ?? '',
    abutment_date: implant?.abutment_date ?? '',
    crown_date: implant?.crown_date ?? '',
    cost: implant?.cost ?? 0,
    paid_amount: implant?.paid_amount ?? 0,
    torque: initTorque,
    isq: initIsq,
    lot: initLot,
    notes: cleanNotes,
  });

  const [formError, setFormError] = useState<string | null>(null);
  const submit = async () => {
    if (!form.patient_id) {
      setFormError('لطفاً بیمار را انتخاب کنید.');
      return;
    }
    setFormError(null);

    const specs: string[] = [];
    if (form.torque.trim()) specs.push(`[تورک: ${form.torque.trim()} N.cm]`);
    if (form.isq.trim()) specs.push(`[ISQ: ${form.isq.trim()}]`);
    if (form.lot.trim()) specs.push(`[لات: ${form.lot.trim()}]`);

    const finalNotes = [...specs, form.notes.trim()].filter(Boolean).join(' ');

    const ok = await onSave({
      patient_id: form.patient_id || null,
      tooth_number: form.tooth_number ? Number(form.tooth_number) : null,
      brand: form.brand.trim() || null,
      implant_size: form.implant_size.trim() || null,
      notes: finalNotes || null,
      stage: form.stage,
      cost: Number(form.cost),
      paid_amount: Number(form.paid_amount),
      placement_date: form.placement_date || null,
      osseointegration_date: form.osseointegration_date || null,
      abutment_date: form.abutment_date || null,
      crown_date: form.crown_date || null,
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
          <Field label="شماره دندان"><Input type="number" value={form.tooth_number} onChange={e => setForm({ ...form, tooth_number: e.target.value })} placeholder="مثلاً ۱۶" /></Field>
          <Field label="برند فیکسچر"><Input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="مثلاً Straumann" /></Field>
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {loadImplantBrands().map(imp => (
            <button
              type="button"
              key={imp.id}
              onClick={() => setForm(prev => ({ ...prev, brand: imp.brandName }))}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                form.brand === imp.brandName ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-cyan-50 text-cyan-700 border-cyan-200'
              }`}
            >
              {imp.brandName}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="سایز ایمپلنت"><Input value={form.implant_size} onChange={e => setForm({ ...form, implant_size: e.target.value })} placeholder="مثلاً 4.3×10mm" /></Field>
        <Field label="مرحله">
          <Select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })} options={STAGES.map(s => ({ value: s.value, label: s.label }))} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="تورک (N.cm)"><Input value={form.torque} onChange={e => setForm({ ...form, torque: e.target.value })} placeholder="مثلاً 45" /></Field>
        <Field label="ضریب ISQ"><Input value={form.isq} onChange={e => setForm({ ...form, isq: e.target.value })} placeholder="مثلاً 75" /></Field>
        <Field label="شماره لات / بچ"><Input value={form.lot} onChange={e => setForm({ ...form, lot: e.target.value })} placeholder="SN / Lot" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ جایگذاری"><JalaliDatePicker value={form.placement_date} onChange={v => setForm({ ...form, placement_date: v })} /></Field>
        <Field label="تاریخ ادغام استخوان"><JalaliDatePicker value={form.osseointegration_date} onChange={v => setForm({ ...form, osseointegration_date: v })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ اباتمان"><JalaliDatePicker value={form.abutment_date} onChange={v => setForm({ ...form, abutment_date: v })} /></Field>
        <Field label="تاریخ روکش"><JalaliDatePicker value={form.crown_date} onChange={v => setForm({ ...form, crown_date: v })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="هزینه کل (تومان)"><Input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: Number(e.target.value) })} /></Field>
        <Field label="پرداخت‌شده (تومان)"><Input type="number" value={form.paid_amount} onChange={e => setForm({ ...form, paid_amount: Number(e.target.value) })} /></Field>
      </div>
      <Field label="یادداشت بالینی"><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="یادداشت جراحی، نوع بایرومتریال یا ممبران..." /></Field>
      {formError && <p className="text-xs text-red-500 px-1">{formError}</p>}
      <Button onClick={submit} color="#06B6D4" disabled={saving} className="w-full">
        {saving ? 'در حال ذخیره...' : 'ذخیره ایمپلنت'}
      </Button>
    </div>
  );
}
