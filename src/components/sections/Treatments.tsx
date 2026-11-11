import { useState, useMemo } from 'react';
import {
  Stethoscope, Plus, Search, ScanLine, Wallet,
  UserCog, FlaskConical, Package, TrendingDown,
  ChevronDown, ChevronUp, Smile,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { supabase, type Treatment, type Patient, type Payment, type TreatmentService } from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Input, Badge, EmptyState, Loading } from '@/components/ui/Form';
import { PalmerChart } from '@/components/PalmerChart';
import { TreatmentForm } from '@/components/sections/TreatmentForm';
import { toJalaliStr } from '@/lib/jalali';
import { serviceLineTotal } from '@/lib/treatmentServices';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  planned:     { label: 'برنامه‌ریزی',  color: '#F59E0B', bg: '#FEF3C7' },
  in_progress: { label: 'در حال انجام', color: '#3B82F6', bg: '#DBEAFE' },
  completed:   { label: 'تکمیل‌شده',    color: '#22C55E', bg: '#DCFCE7' },
  cancelled:   { label: 'لغوشده',      color: '#EF4444', bg: '#FEE2E2' },
};

const SERVICE_STATUS_LABEL: Record<TreatmentService['status'], string> = {
  planned: 'برنامه‌ریزی',
  done: 'انجام‌شده',
  cancelled: 'لغوشده',
};

const fmt = (n: number) => Number(n).toLocaleString('fa-IR');
const faDigits = (s: string) => s.replace(/\d+/g, d => Number(d).toLocaleString('fa-IR'));

export function Treatments() {
  const { data: treatments, loading, refresh } = useRealtimeTable<Treatment>('treatments');
  const { data: patients } = useRealtimeTable<Patient>('patients');
  const { data: payments } = useRealtimeTable<Payment>('payments');
  const { data: services } = useRealtimeTable<TreatmentService>('treatment_services');

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Treatment | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [palmerPatientId, setPalmerPatientId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = treatments;
    if (filter !== 'all') list = list.filter(t => t.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(t => {
        const patient = patients.find(p => p.id === t.patient_id);
        return (
          (patient ? `${patient.first_name} ${patient.last_name}`.toLowerCase().includes(q) : false) ||
          t.diagnosis?.toLowerCase().includes(q) ||
          t.tooth_numbers?.toLowerCase().includes(q)
        );
      });
    }
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [treatments, patients, search, filter]);

  const servicesByTreatment = useMemo(() => {
    const map = new Map<string, TreatmentService[]>();
    for (const s of services) {
      const list = map.get(s.treatment_id) ?? [];
      list.push(s);
      map.set(s.treatment_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.service_date.localeCompare(b.service_date) || a.created_at.localeCompare(b.created_at));
    }
    return map;
  }, [services]);

  const stats = useMemo(() => {
    const totalDoctor = treatments.reduce((s, t) => s + Number(t.doctor_cost || 0), 0);
    const totalLab    = treatments.reduce((s, t) => s + Number(t.lab_cost || 0), 0);
    const totalMat    = treatments.reduce((s, t) => s + Number(t.material_cost || 0), 0);
    const totalAll    = treatments.reduce((s, t) => s + Number(t.total_cost || 0), 0);
    const totalPaid   = treatments.reduce((s, t) => s + Number(t.paid_amount || 0), 0);
    return { totalDoctor, totalLab, totalMat, totalAll, totalPaid, balance: totalAll - totalPaid };
  }, [treatments]);

  const getPatient = (id: string | null) => patients.find(p => p.id === id);
  const getPayments = (treatmentId: string) => payments.filter(p => p.treatment_id === treatmentId);

  const openNew = () => {
    setEditing(null);
    setFormKey(k => k + 1);
    setSheetOpen(true);
  };

  const openEdit = (t: Treatment) => {
    setEditing(t);
    setFormKey(k => k + 1);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
  };

  const handleSaved = () => {
    closeSheet();
    refresh();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from('treatments').delete().eq('id', deleteId);
    setDeleteId(null);
    refresh();
  };

  if (loading) return <Loading color="#8B5CF6" />;

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* ── QBank Sliding Horizontal Chip Bar + Expandable Magnifier Search ── */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen || search
                ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
            title="جستجوی بیمار، تشخیص یا شماره دندان"
            aria-label="جستجوی درمان"
          >
            <Search size={17} />
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {[
              { v: 'all', l: 'همه درمان‌ها', c: treatments.length, color: '#7C3AED' },
              { v: 'in_progress', l: 'در حال انجام', c: treatments.filter(t => t.status === 'in_progress').length, color: '#2563EB' },
              { v: 'planned', l: 'طرح درمان', c: treatments.filter(t => t.status === 'planned').length, color: '#D97706' },
              { v: 'completed', l: 'تکمیل‌شده', c: treatments.filter(t => t.status === 'completed').length, color: '#059669' },
              { v: 'cancelled', l: 'لغوشده', c: treatments.filter(t => t.status === 'cancelled').length, color: '#E11D48' },
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
          </div>

          <button
            onClick={openNew}
            className="w-9 h-9 rounded-2xl bg-violet-500 hover:bg-violet-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            aria-label="درمان جدید"
            title="ثبت درمان و چارت پالمر جدید"
          >
            <Plus size={20} />
          </button>
        </div>

        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-600" />
              <Input
                autoFocus
                placeholder="جستجوی نام بیمار، تشخیص یا شماره دندان..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 text-xs"
              />
            </div>
          </div>
        )}

        {/* Compact Financial Summary Bar */}
        <div className="grid grid-cols-3 gap-1.5 mt-2 pt-2 border-t border-gray-100">
          <CostStat icon={<UserCog size={12} />} label="دستمزد پزشک" value={stats.totalDoctor} color="#8B5CF6" />
          <CostStat icon={<FlaskConical size={12} />} label="لابراتوار" value={stats.totalLab} color="#EC4899" />
          <CostStat icon={<Package size={12} />} label="مواد مصرفی" value={stats.totalMat} color="#F97316" />
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState icon={<Stethoscope size={28} />} title="درمانی یافت نشد" color="#8B5CF6" />
      ) : (
        <div className="space-y-2 stagger">
          {filtered.map(t => {
            const patient = getPatient(t.patient_id);
            const status = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.planned;
            const tPayments = getPayments(t.id);
            const paid = tPayments.reduce((s, p) => s + Number(p.amount), 0);
            const balance = Number(t.total_cost) - paid;
            const isExpanded = expandedId === t.id;
            const tServices = servicesByTreatment.get(t.id) ?? [];
            const docCost = Number(t.doctor_cost || 0);
            const labCost = Number(t.lab_cost || 0);
            const matCost = Number(t.material_cost || 0);
            const othCost = Number(t.other_cost || 0);
            const disc   = Number(t.discount || 0);
            const hasBreakdown = docCost > 0 || labCost > 0 || matCost > 0 || othCost > 0 || disc > 0;
            const paidPct = Math.min(100, (paid / Math.max(Number(t.total_cost), 1)) * 100);

            return (
              <div key={t.id} className="glass-card overflow-hidden">
                <div
                  className="p-3.5 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                        <Stethoscope size={16} className="text-violet-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">{patient ? `${patient.first_name} ${patient.last_name}` : 'نامشخص'}</p>
                        <p className="text-[10px] text-gray-400">{toJalaliStr(t.created_at.slice(0, 10))}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </div>
                  </div>

                  {t.diagnosis && <p className="text-xs text-gray-600 mb-1">تشخیص: {t.diagnosis}</p>}
                  <p className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                    <ScanLine size={12} />
                    {tServices.length > 0 ? `${fmt(tServices.length)} خدمت` : 'بدون ریز خدمت'}
                    {t.tooth_numbers ? ` · دندان‌ها: ${faDigits(t.tooth_numbers)}` : ''}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <span className="text-xs font-bold text-violet-600">{fmt(t.total_cost)} ت</span>
                    {balance > 0 ? (
                      <span className="text-xs text-red-500">باقی: {fmt(balance)} ت</span>
                    ) : (
                      <span className="text-xs text-green-500">تسویه</span>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3.5 pb-3.5 animate-fade-in space-y-2.5">
                    {tServices.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-gray-500">ریز خدمات</p>
                        {tServices.map(s => (
                          <div key={s.id} className="rounded-xl bg-white/70 border border-gray-100 p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs font-bold text-gray-800 truncate ${s.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>
                                {s.procedure_name}
                              </p>
                              <span className="text-[10px] text-gray-500 shrink-0">{SERVICE_STATUS_LABEL[s.status]}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {toJalaliStr(s.service_date)}
                              {s.tooth_number ? ` · دندان ${fmt(s.tooth_number)}` : ''}
                              {s.surfaces ? ` · سطح ${s.surfaces}` : ''}
                              {` · ${fmt(s.quantity)} × ${fmt(Number(s.unit_fee))} = ${fmt(serviceLineTotal(s))} ت`}
                            </p>
                            {s.notes && <p className="text-[10px] text-gray-500 mt-1">{s.notes}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {hasBreakdown && (
                      <div className="bg-violet-50/50 rounded-2xl p-3 space-y-1.5">
                        <p className="text-[10px] font-bold text-gray-500 mb-1">تفکیک هزینه‌ها</p>
                        {docCost > 0 && <CostRow icon={<UserCog size={11} />} label="دستمزد پزشک" value={docCost} color="#8B5CF6" />}
                        {labCost > 0 && <CostRow icon={<FlaskConical size={11} />} label="لابراتوار" value={labCost} color="#EC4899" />}
                        {matCost > 0 && <CostRow icon={<Package size={11} />} label="مواد مصرفی" value={matCost} color="#F97316" />}
                        {othCost > 0 && <CostRow icon={<Wallet size={11} />} label="سایر" value={othCost} color="#6B7280" />}
                        {disc > 0 && <CostRow icon={<TrendingDown size={11} />} label="تخفیف" value={-disc} color="#22C55E" />}
                        <div className="flex items-center justify-between pt-1.5 border-t border-violet-100">
                          <span className="text-[10px] font-bold text-gray-600">مجموع</span>
                          <span className="text-xs font-black text-violet-600">{fmt(t.total_cost)} ت</span>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-400">پرداخت: {fmt(paid)} / {fmt(t.total_cost)}</span>
                        <span className="text-[10px] font-bold text-violet-600">{fmt(Math.round(paidPct))}٪</span>
                      </div>
                      <div className="prog-track h-2">
                        <div className="prog-fill" style={{ width: `${paidPct}%`, background: 'linear-gradient(90deg,#8B5CF6,#A78BFA)' }} />
                      </div>
                    </div>

                    {t.notes && <p className="text-xs text-gray-400 bg-gray-50 rounded-xl p-2">{t.notes}</p>}

                    <div className="flex gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(t); }}
                        className="flex-1 py-2 rounded-xl bg-violet-50 text-violet-600 text-xs font-bold haptic"
                      >
                        ویرایش
                      </button>
                      {patient && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPalmerPatientId(palmerPatientId === t.patient_id ? null : t.patient_id); }}
                          className="flex-1 py-2 rounded-xl bg-cyan-50 text-cyan-600 text-xs font-bold haptic flex items-center justify-center gap-1"
                        >
                          <Smile size={13} /> چارت دندانی
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteId(t.id); }}
                        className="px-3 py-2 rounded-xl bg-red-50 text-red-400 text-xs font-bold haptic"
                      >
                        حذف
                      </button>
                    </div>

                    {palmerPatientId === t.patient_id && patient && (
                      <div className="animate-scale-in pt-2">
                        <PalmerChart patientId={patient.id} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        title={editing ? 'ویرایش درمان' : 'درمان جدید'}
        icon={<Stethoscope size={20} />}
        color="#8B5CF6"
      >
        <TreatmentForm
          key={formKey}
          treatment={editing}
          treatmentServices={editing ? (servicesByTreatment.get(editing.id) ?? []) : []}
          patients={patients}
          onSaved={handleSaved}
        />
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف درمان"
        message="آیا از حذف این درمان اطمینان دارید؟ ریز خدمات این درمان نیز حذف می‌شود."
        confirmLabel="حذف"
      />
    </div>
  );
}

function CostStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-2 text-center" style={{ background: `${color}10` }}>
      <div className="w-6 h-6 rounded-lg flex items-center justify-center mx-auto mb-0.5" style={{ background: `${color}20`, color }}>
        {icon}
      </div>
      <p className="text-[11px] font-black" style={{ color }}>{fmt(value)}</p>
      <p className="text-[9px] text-gray-400">{label}</p>
    </div>
  );
}

function CostRow({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[11px] text-gray-600" style={{ color }}>
        {icon} {label}
      </span>
      <span className="text-[11px] font-bold" style={{ color }}>
        {value < 0 ? '-' : ''}{fmt(Math.abs(value))} ت
      </span>
    </div>
  );
}
