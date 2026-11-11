import { useState, useMemo } from 'react';
import {
  Package, Plus, Search, X, AlertTriangle, TrendingDown, Calendar,
  MapPin, Boxes, Building2, Minus, ArrowUpRight,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { supabase, type InventoryItem } from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr } from '@/lib/jalali';
import { ClinicDefinitionsModal } from '@/components/ui/ClinicDefinitionsModal';
import { loadSupplyCompanies } from '@/lib/clinicDefinitions';

const CATEGORIES = [
  { value: 'general', label: 'عمومی' },
  { value: 'medication', label: 'دارو' },
  { value: 'instrument', label: 'ابزار' },
  { value: 'material', label: 'متریال' },
  { value: 'equipment', label: 'تجهیزات' },
  { value: 'hygiene', label: 'بهداشتی' },
  { value: 'other', label: 'سایر' },
];

type InventoryChipKey = 'all' | 'low_stock' | 'expiring' | string;

export function Inventory() {
  const { data: items, refresh } = useRealtimeTable<InventoryItem>('inventory');

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeChip, setActiveChip] = useState<InventoryChipKey>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [defsModalOpen, setDefsModalOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stats = useMemo(() => {
    const lowStock = items.filter(i => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0);
    const expired = items.filter(i => {
      if (!i.expiry_date) return false;
      return new Date(i.expiry_date).getTime() < Date.now();
    });
    const expiringSoon = items.filter(i => {
      if (!i.expiry_date) return false;
      const days = (new Date(i.expiry_date).getTime() - Date.now()) / 86400000;
      return days <= 60;
    });
    const totalValue = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0);
    return {
      lowStock: lowStock.length,
      expired: expired.length,
      expiringSoon: expiringSoon.length,
      totalValue,
    };
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (activeChip === 'low_stock') {
      list = list.filter(i => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0);
    } else if (activeChip === 'expiring') {
      list = list.filter(i => {
        if (!i.expiry_date) return false;
        const days = (new Date(i.expiry_date).getTime() - Date.now()) / 86400000;
        return days <= 60;
      });
    } else if (activeChip !== 'all') {
      list = list.filter(i => i.category === activeChip);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.sku?.toLowerCase().includes(q) ||
        i.supplier?.toLowerCase().includes(q) ||
        i.location?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, search, activeChip]);

  const handleSave = async (data: Partial<InventoryItem>) => {
    setSaving(true);
    if (editing) {
      await supabase.from('inventory').update(data).eq('id', editing.id);
    } else {
      await supabase.from('inventory').insert(data);
    }
    setSaving(false);
    setSheetOpen(false);
    setEditing(null);
    refresh();
  };

  const handleQuickAdjust = async (item: InventoryItem, delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextQty = Math.max(0, Number(item.quantity) + delta);
    await supabase.from('inventory').update({ quantity: nextQty }).eq('id', item.id);
    refresh();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from('inventory').delete().eq('id', deleteId);
    setDeleteId(null);
    refresh();
  };

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* QBank Top Bar: Sliding Horizontal Chip Bar + Animated Magnifying Glass Search */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          {/* Expandable Magnifying Glass Button */}
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen || search
                ? 'bg-orange-500 text-white shadow-md'
                : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
            }`}
            title="جستجو در انبار"
            data-testid="inventory_search_toggle"
          >
            {searchOpen ? <X size={17} /> : <Search size={17} />}
          </button>

          {/* Horizontal Sliding Chip Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            <button
              onClick={() => setActiveChip('all')}
              className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic shrink-0 ${
                activeChip === 'all'
                  ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-sm'
                  : 'bg-gray-100/90 text-gray-600'
              }`}
            >
              همه اقلام ({items.length.toLocaleString('fa-IR')})
            </button>
            <button
              onClick={() => setActiveChip('low_stock')}
              className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic shrink-0 flex items-center gap-1 ${
                activeChip === 'low_stock'
                  ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-sm'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}
            >
              <AlertTriangle size={12} /> کمبود موجودی ({stats.lowStock.toLocaleString('fa-IR')})
            </button>
            <button
              onClick={() => setActiveChip('expiring')}
              className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic shrink-0 ${
                activeChip === 'expiring'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              هشدار انقضا ({stats.expiringSoon.toLocaleString('fa-IR')})
            </button>
            {CATEGORIES.map(c => {
              const count = items.filter(i => i.category === c.value).length;
              return (
                <button
                  key={c.value}
                  onClick={() => setActiveChip(c.value)}
                  className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic shrink-0 ${
                    activeChip === c.value
                      ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-sm'
                      : 'bg-gray-100/90 text-gray-600'
                  }`}
                >
                  {c.label} ({count.toLocaleString('fa-IR')})
                </button>
              );
            })}
            <button
              onClick={() => setDefsModalOpen(true)}
              className="px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap bg-amber-50 text-amber-700 border border-amber-200 shrink-0 haptic flex items-center gap-1"
            >
              <Building2 size={12} /> شرکت‌های تامین کالا
            </button>
          </div>

          {/* Quick Add Item Button */}
          <button
            onClick={() => { setEditing(null); setSheetOpen(true); }}
            className="w-9 h-9 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            title="افزودن کالای جدید"
            data-testid="add_inventory_button"
          >
            <Plus size={19} />
          </button>
        </div>

        {/* Animated Collapsible Search Input */}
        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-fade-in">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-orange-500" />
              <Input
                autoFocus
                placeholder="جستجوی نام کالا، کد انبار (SKU)، شرکت تامین‌کننده یا قفسه..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 pl-8 text-xs"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* QBank Curved-Notch Inventory Radar Strip */}
      <div
        className="qbank-tile p-3 text-white shadow-md"
        style={{ background: 'linear-gradient(135deg, #EA580C 0%, #D97706 55%, #B45309 100%)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <Boxes size={16} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-orange-100">ارزش کل موجودی انبار مطب</p>
              <p className="text-base font-black">{stats.totalValue.toLocaleString('fa-IR')} تومان</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveChip('low_stock')}
              className="px-2.5 py-1 rounded-xl bg-white/20 hover:bg-white/25 text-[10px] font-black flex items-center gap-1"
            >
              <AlertTriangle size={11} /> {stats.lowStock.toLocaleString('fa-IR')} کمبود
            </button>
            <button
              onClick={() => setActiveChip('expiring')}
              className="px-2.5 py-1 rounded-xl bg-white/15 hover:bg-white/25 text-[10px] font-black"
            >
              {stats.expiringSoon.toLocaleString('fa-IR')} انقضا
            </button>
          </div>
        </div>
        <div className="qbank-corner-key" style={{ color: '#EA580C' }}>
          <ArrowUpRight size={13} strokeWidth={2.6} />
        </div>
      </div>

      {/* Inventory Cards List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Package size={28} />}
          title="کالایی در این بخش یافت نشد"
          subtitle="برای ثبت متریال یا ابزار جدید روی دکمه + بالا بزنید"
          color="#F97316"
        />
      ) : (
        <div className="space-y-2 stagger">
          {filtered.map(item => {
            const isLow = Number(item.quantity) <= Number(item.min_quantity) && Number(item.min_quantity) > 0;
            const daysToExpiry = item.expiry_date
              ? Math.ceil((new Date(item.expiry_date).getTime() - Date.now()) / 86400000)
              : null;
            const isExpired = daysToExpiry !== null && daysToExpiry < 0;
            const isExpiring = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 60;
            const catLabel = CATEGORIES.find(c => c.value === item.category)?.label ?? item.category;
            const isExpanded = expandedId === item.id;

            return (
              <div
                key={item.id}
                className="glass-card p-3.5 transition-all"
                style={{
                  borderRight: isLow || isExpired ? '4px solid #EF4444' : isExpiring ? '4px solid #F59E0B' : '4px solid #F97316',
                }}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div
                    onClick={() => { setEditing(item); setSheetOpen(true); }}
                    className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                  >
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: isExpired ? '#FEE2E2' : isLow ? '#FEF3C7' : '#FFEDD5' }}
                    >
                      <Package size={19} style={{ color: isExpired ? '#DC2626' : isLow ? '#D97706' : '#F97316' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-black text-gray-800 truncate">{item.name}</p>
                        <span className="px-2 py-0.5 rounded-lg bg-orange-50 text-orange-700 text-[10px] font-extrabold">
                          {catLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                        {item.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin size={10} className="text-orange-500" /> {item.location}
                          </span>
                        )}
                        {item.expiry_date && (
                          <span className="flex items-center gap-0.5">
                            <Calendar size={10} className="text-amber-500" /> {toJalaliStr(item.expiry_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quick +1 / -1 Stock Counter */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={e => handleQuickAdjust(item, -1, e)}
                      className="w-7 h-7 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center font-black haptic"
                      title="کسر ۱ واحد از موجودی"
                    >
                      <Minus size={13} />
                    </button>
                    <div className="text-center min-w-[44px]">
                      <p className={`text-sm font-black leading-none ${isLow ? 'text-red-600' : 'text-slate-800'}`}>
                        {Number(item.quantity).toLocaleString('fa-IR')}
                      </p>
                      <p className="text-[9.5px] font-bold text-gray-400 mt-0.5">{item.unit}</p>
                    </div>
                    <button
                      onClick={e => handleQuickAdjust(item, 1, e)}
                      className="w-7 h-7 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 flex items-center justify-center font-black haptic"
                      title="افزودن ۱ واحد به موجودی"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>

                {/* Alarms & Expand Toggle */}
                <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-gray-100">
                  <div className="flex items-center flex-wrap gap-1.5">
                    {isLow && (
                      <Badge color="#EF4444" bg="#FEE2E2">
                        <TrendingDown size={10} /> آلارم کمبود (حداقل: {Number(item.min_quantity).toLocaleString('fa-IR')})
                      </Badge>
                    )}
                    {isExpired && (
                      <Badge color="#DC2626" bg="#FEE2E2">
                        <AlertTriangle size={10} /> منقضی ({Math.abs(daysToExpiry || 0)} روز)
                      </Badge>
                    )}
                    {isExpiring && (
                      <Badge color="#D97706" bg="#FEF3C7">
                        <Calendar size={10} /> انقضا: {daysToExpiry} روز مانده
                      </Badge>
                    )}
                    {!isLow && !isExpired && !isExpiring && (
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">
                        ✓ موجودی استاندارد
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="text-[10px] font-extrabold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-lg shrink-0"
                  >
                    {isExpanded ? 'بستن جزئیات ▲' : 'جزئیات و تامین‌کننده ▼'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200 space-y-2 animate-fade-in text-xs">
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="rounded-xl bg-slate-50 p-1.5">
                        <p className="text-[9px] text-gray-400">قیمت واحد</p>
                        <p className="font-black text-slate-700">{Number(item.unit_cost).toLocaleString('fa-IR')} ت</p>
                      </div>
                      <div className="rounded-xl bg-orange-50/70 p-1.5">
                        <p className="text-[9px] text-orange-600">ارزش کل</p>
                        <p className="font-black text-orange-700">
                          {(Number(item.quantity) * Number(item.unit_cost)).toLocaleString('fa-IR')} ت
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-1.5">
                        <p className="text-[9px] text-gray-400">شرکت تامین‌کننده</p>
                        <p className="font-bold text-slate-700 truncate">{item.supplier || 'ثبت نشده'}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { setEditing(item); setSheetOpen(true); }}
                        className="flex-1 py-1.5 rounded-xl bg-orange-50 text-orange-700 font-extrabold haptic"
                      >
                        ویرایش کامل کالا
                      </button>
                      <button
                        onClick={() => setDeleteId(item.id)}
                        className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 font-extrabold haptic"
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

      <Sheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
        title={editing ? 'ویرایش کالا' : 'کالای جدید'}
        icon={<Package size={20} />}
        color="#F97316"
      >
        <InventoryForm item={editing} onSave={handleSave} saving={saving} />
      </Sheet>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف کالا"
        message="آیا از حذف این کالا از انبار اطمینان دارید؟"
        confirmLabel="حذف"
      />

      <ClinicDefinitionsModal
        open={defsModalOpen}
        onClose={() => setDefsModalOpen(false)}
        initialTab="companies"
      />
    </div>
  );
}

function InventoryForm({
  item,
  onSave,
  saving,
}: {
  item: InventoryItem | null;
  onSave: (data: Partial<InventoryItem>) => void;
  saving: boolean;
}) {
  const companies = useMemo(() => loadSupplyCompanies(), []);
  const [form, setForm] = useState({
    name: item?.name ?? '',
    sku: item?.sku ?? '',
    category: item?.category ?? 'general',
    quantity: item?.quantity ? String(item.quantity) : '0',
    min_quantity: item?.min_quantity ? String(item.min_quantity) : '5',
    unit: item?.unit ?? 'عدد',
    unit_cost: item?.unit_cost ? String(item.unit_cost) : '',
    supplier: item?.supplier ?? (companies[0]?.name || ''),
    expiry_date: item?.expiry_date ?? '',
    location: item?.location ?? '',
    notes: item?.notes ?? '',
  });

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    onSave({
      name: form.name,
      sku: form.sku || null,
      category: form.category,
      quantity: Number(form.quantity) || 0,
      min_quantity: Number(form.min_quantity) || 0,
      unit: form.unit,
      unit_cost: Number(form.unit_cost) || 0,
      supplier: form.supplier || null,
      expiry_date: form.expiry_date || null,
      location: form.location || null,
      notes: form.notes || null,
    });
  };

  return (
    <div className="space-y-4">
      <Field label="نام کالا *">
        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="کامپوزیت، دستکش، سرنگ بی‌حسی..." />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="دسته‌بندی">
          <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={CATEGORIES} />
        </Field>
        <Field label="کد کالا (SKU)">
          <Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="اختیاری" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="موجودی فعلی">
          <Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
        </Field>
        <Field label="حداقل آلارم کمبود">
          <Input type="number" value={form.min_quantity} onChange={e => setForm({ ...form, min_quantity: e.target.value })} />
        </Field>
        <Field label="واحد">
          <Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="عدد، بسته..." />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="قیمت واحد (تومان)">
          <Input type="number" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} />
        </Field>
        <Field label="تأمین‌کننده (از تعاریف)">
          <Select
            value={form.supplier}
            onChange={e => setForm({ ...form, supplier: e.target.value })}
            options={[
              { value: '', label: 'انتخاب شرکت...' },
              ...companies.map(c => ({ value: c.name, label: `${c.name} (${c.category})` })),
              ...(form.supplier && !companies.some(c => c.name === form.supplier)
                ? [{ value: form.supplier, label: form.supplier }]
                : []),
            ]}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ انقضا">
          <JalaliDatePicker value={form.expiry_date} onChange={v => setForm({ ...form, expiry_date: v })} placeholder="انتخاب تاریخ" />
        </Field>
        <Field label="محل نگهداری">
          <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="کمد ۱، یخچال..." />
        </Field>
      </div>
      <Field label="یادداشت">
        <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
      </Field>
      <Button onClick={handleSubmit} color="#F97316" disabled={saving || !form.name.trim()} className="w-full">
        {saving ? 'در حال ذخیره...' : editingLabel(item)}
      </Button>
    </div>
  );
}

function editingLabel(item: InventoryItem | null) {
  return item ? 'بروزرسانی کالا' : 'ثبت کالا در انبار';
}
