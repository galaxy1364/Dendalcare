import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, UserCog } from 'lucide-react';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { ToothPicker } from '@/components/ui/ToothPicker';
import { Field, Input, Select, Button, Badge } from '@/components/ui/Form';
import { toJalaliStr } from '@/lib/jalali';
import {
  PROCEDURE_SUGGESTIONS, SURFACE_SUGGESTIONS, SERVICE_STATUS_OPTIONS,
  emptyServiceDraft, serviceLineTotal, validateServiceDraft,
  type ServiceDraft,
} from '@/lib/treatmentServices';

const fmt = (n: number) => Number(n).toLocaleString('fa-IR');

const STATUS_STYLE: Record<ServiceDraft['status'], { label: string; color: string; bg: string }> = {
  planned:   { label: 'برنامه‌ریزی', color: '#F59E0B', bg: '#FEF3C7' },
  done:      { label: 'انجام‌شده',   color: '#22C55E', bg: '#DCFCE7' },
  cancelled: { label: 'لغوشده',      color: '#EF4444', bg: '#FEE2E2' },
};

type Props = {
  services: ServiceDraft[];
  onChange: (services: ServiceDraft[]) => void;
};

export function ServicesEditor({ services, onChange }: Props) {
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft());
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setDraft(emptyServiceDraft());
    setIsNew(true);
    setEditIndex(services.length);
    setError(null);
  };

  const openEdit = (index: number) => {
    setDraft(services[index]);
    setIsNew(false);
    setEditIndex(index);
    setError(null);
  };

  const closeEditor = () => {
    setEditIndex(null);
    setError(null);
  };

  const removeAt = (index: number) => {
    onChange(services.filter((_, i) => i !== index));
  };

  const commit = () => {
    const problem = validateServiceDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    if (isNew) {
      onChange([...services, draft]);
    } else if (editIndex !== null) {
      onChange(services.map((s, i) => (i === editIndex ? draft : s)));
    }
    closeEditor();
  };

  if (editIndex !== null) {
    return (
      <div className="rounded-2xl bg-white border border-violet-100 p-3 space-y-3 animate-scale-in">
        <p className="text-xs font-bold text-violet-700">{isNew ? 'خدمت جدید' : 'ویرایش خدمت'}</p>

        <Field label="نام خدمت">
          <Input
            list="treatment-procedure-suggestions"
            value={draft.procedure_name}
            onChange={e => setDraft({ ...draft, procedure_name: e.target.value })}
            placeholder="مثلاً ترمیم کامپوزیت"
          />
          <datalist id="treatment-procedure-suggestions">
            {PROCEDURE_SUGGESTIONS.map(p => <option key={p} value={p} />)}
          </datalist>
        </Field>

        <Field label="دندان">
          <ToothPicker value={draft.tooth_number} onChange={t => setDraft({ ...draft, tooth_number: t })} />
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="سطوح دندان">
            <Input
              list="treatment-surface-suggestions"
              value={draft.surfaces}
              onChange={e => setDraft({ ...draft, surfaces: e.target.value.toUpperCase() })}
              placeholder="مثلاً MOD"
            />
            <datalist id="treatment-surface-suggestions">
              {SURFACE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </Field>
          <Field label="تاریخ خدمت">
            <JalaliDatePicker value={draft.service_date} onChange={d => setDraft({ ...draft, service_date: d })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="تعداد">
            <Input type="number" min={1} step={1} value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: Number(e.target.value) })} />
          </Field>
          <Field label="دستمزد هر واحد (تومان)">
            <div className="relative">
              <UserCog size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-400" />
              <Input type="number" min={0} value={draft.unit_fee} onChange={e => setDraft({ ...draft, unit_fee: Number(e.target.value) })} className="pr-9" />
            </div>
          </Field>
        </div>

        <Field label="وضعیت خدمت">
          <Select
            value={draft.status}
            onChange={e => setDraft({ ...draft, status: e.target.value as ServiceDraft['status'] })}
            options={SERVICE_STATUS_OPTIONS}
          />
        </Field>

        <Field label="یادداشت خدمت">
          <Input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="اختیاری" />
        </Field>

        <div className="flex items-center justify-between rounded-xl bg-violet-50/60 px-3 py-2">
          <span className="text-[11px] font-bold text-gray-600">دستمزد این خدمت</span>
          <span className="text-sm font-black text-violet-600">{fmt(serviceLineTotal(draft))} ت</span>
        </div>

        {error && <p className="text-xs text-red-500 px-1">{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={closeEditor} icon={<X size={15} />}>انصراف</Button>
          <Button onClick={commit} color="#8B5CF6" icon={<Check size={15} />}>ثبت خدمت</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-violet-700">خدمات درمانی ({fmt(services.length)})</p>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-500 text-white text-[11px] font-bold haptic"
        >
          <Plus size={13} /> افزودن خدمت
        </button>
      </div>

      {services.length === 0 ? (
        <p className="text-[11px] text-gray-400 text-center rounded-xl bg-gray-50 py-4">
          هنوز خدمتی ثبت نشده است.
        </p>
      ) : (
        <div className="space-y-1.5 stagger">
          {services.map((s, index) => {
            const st = STATUS_STYLE[s.status];
            return (
              <div key={s.id ?? `new-${index}`} className="rounded-xl bg-white border border-gray-100 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-xs font-bold text-gray-800 truncate ${s.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>
                      {s.procedure_name}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {toJalaliStr(s.service_date)}
                      {s.tooth_number ? ` · دندان ${fmt(s.tooth_number)}` : ''}
                      {s.surfaces ? ` · سطح ${s.surfaces}` : ''}
                    </p>
                  </div>
                  <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-gray-500">
                    {fmt(s.quantity)} × {fmt(s.unit_fee)} = <b className="text-violet-600">{fmt(serviceLineTotal(s))} ت</b>
                  </span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => openEdit(index)} className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center haptic" aria-label="ویرایش خدمت">
                      <Pencil size={12} />
                    </button>
                    <button type="button" onClick={() => removeAt(index)} className="w-7 h-7 rounded-lg bg-red-50 text-red-400 flex items-center justify-center haptic" aria-label="حذف خدمت">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
