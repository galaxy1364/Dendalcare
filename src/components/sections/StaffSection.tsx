import { useState, useMemo } from 'react';
import {
  UserCog, Plus, Search, X, Phone, Stethoscope, BadgeCheck,
  Wallet, Percent, Users, Trash2, CheckCircle2, Calculator, ShieldCheck, ArrowUpRight,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase,
  type Staff,
  type StaffSalary,
  type StaffShare,
  type FinanceTransaction,
  type Treatment,
  type LabOrder,
} from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Select, Button, Badge, EmptyState } from '@/components/ui/Form';
import { todayGregorian, dateStrToJalali } from '@/lib/jalali';
import {
  loadClinicUsers,
  saveClinicUsers,
  type ClinicUserAccount,
  type ClinicUserRole,
} from '@/lib/cloudSyncEngine';

const ROLES = [
  { value: 'manager', label: 'مدیر کلینیک (پزشک ارشد)' },
  { value: 'dentist', label: 'پزشک' },
  { value: 'secretary', label: 'منشی' },
  { value: 'assistant', label: 'دستیار' },
  { value: 'hygienist', label: 'بهداشتکار' },
  { value: 'technician', label: 'تکنسین' },
  { value: 'other', label: 'سایر' },
];

const SHARE_APPLIES = [
  { value: 'treatment', label: 'درمان‌ها' },
  { value: 'lab', label: 'لابراتوار' },
  { value: 'implant', label: 'ایمپلنت' },
  { value: 'total', label: 'کل درآمد' },
];

const SALARY_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'در انتظار', color: '#F59E0B', bg: '#FEF3C7' },
  paid: { label: 'پرداخت‌شده', color: '#22C55E', bg: '#DCFCE7' },
  cancelled: { label: 'لغوشده', color: '#EF4444', bg: '#FEE2E2' },
};

const faMonths = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

type StaffTab = 'list' | 'doctor_calc' | 'salaries' | 'shares';

export function StaffSection() {
  const { data: staff, refresh: rs } = useRealtimeTable<Staff>('staff');
  const { data: salaries } = useRealtimeTable<StaffSalary>('staff_salaries');
  const { data: shares } = useRealtimeTable<StaffShare>('staff_shares');
  const { data: finance } = useRealtimeTable<FinanceTransaction>('finance_transactions');
  const { data: treatments } = useRealtimeTable<Treatment>('treatments');
  const { data: labOrders } = useRealtimeTable<LabOrder>('lab_orders');

  const [tab, setTab] = useState<StaffTab>('list');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(s =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      s.role.toLowerCase().includes(q) ||
      s.phone?.includes(q) ||
      s.email?.toLowerCase().includes(q)
    );
  }, [staff, search]);

  const handleSave = async (data: Partial<Staff> & { pinOrPass?: string }) => {
    setSaving(true);
    const { pinOrPass, ...staffData } = data;
    if (editing) {
      await supabase.from('staff').update(staffData).eq('id', editing.id);
    } else {
      await supabase.from('staff').insert(staffData);
    }

    try {
      const existingUsers = loadClinicUsers();
      const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'کاربر جدید';
      const role = (data.role || 'secretary') as ClinicUserRole;
      const userEmail = data.email || `${role}_${Date.now()}@minadental.ir`;

      const userAccount: ClinicUserAccount = {
        id: editing ? `usr_${editing.id}` : `usr_${Date.now()}`,
        fullName,
        name: fullName,
        role,
        roleLabel: ROLES.find(r => r.value === role)?.label || 'کاربر کلینیک',
        email: userEmail,
        phone: data.phone || '',
        pinOrPass: pinOrPass || '1234',
        avatarColor: data.color || '#6366F1',
        canPublishUpdate: role === 'manager',
        permissions: {
          canEditPricesAfterSave: role === 'manager',
          canDeleteCriticalRecords: role === 'manager',
          canPublishOtaUpdate: role === 'manager',
          canManageBackups: role === 'manager',
          canManageStaffAndShares: role === 'manager',
        },
      };

      const updatedUsers = existingUsers.filter(u => u.fullName !== fullName);
      updatedUsers.push(userAccount);
      saveClinicUsers(updatedUsers);
    } catch (e) {
      console.error('Failed to sync user account:', e);
    }

    setSaving(false);
    setFormOpen(false);
    setEditing(null);
    rs();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from('staff').delete().eq('id', deleteId);
    setDeleteId(null);
    rs();
  };

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* QBank Top Bar: Sliding Horizontal Chip Bar + Animated Magnifying Glass Search */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen || search
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
            }`}
            title="جستجوی پرسنل و پزشکان"
            data-testid="staff_search_toggle"
          >
            {searchOpen ? <X size={17} /> : <Search size={17} />}
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {[
              { key: 'list' as const, label: `پرسنل و دسترسی (${staff.length.toLocaleString('fa-IR')})`, icon: <Users size={13} /> },
              { key: 'doctor_calc' as const, label: 'ماشین‌حساب ۳ مدل سهم پزشک', icon: <Calculator size={13} /> },
              { key: 'salaries' as const, label: `حقوق و دستمزد (${salaries.length.toLocaleString('fa-IR')})`, icon: <Wallet size={13} /> },
              { key: 'shares' as const, label: `قوانین سهم‌بندی (${shares.length.toLocaleString('fa-IR')})`, icon: <Percent size={13} /> },
            ].map(ch => (
              <button
                key={ch.key}
                onClick={() => setTab(ch.key)}
                className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic shrink-0 flex items-center gap-1 ${
                  tab === ch.key
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
                    : 'bg-gray-100/90 text-gray-600'
                }`}
              >
                {ch.icon}
                <span>{ch.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => { setEditing(null); setFormOpen(true); }}
            className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            title="افزودن پزشک / پرسنل جدید"
          >
            <Plus size={19} />
          </button>
        </div>

        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-fade-in">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-500" />
              <Input
                autoFocus
                placeholder="جستجوی نام پزشک، منشی، دستیار، ایمیل یا شماره تماس..."
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

      {/* TAB 1: Staff & Role-Based Access Control */}
      {tab === 'list' && (
        <div className="space-y-2.5">
          {/* Manager Crown Card for Dr. Mehdi Amiri */}
          <div
            className="qbank-tile p-3.5 text-white shadow-md"
            style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 55%, #4338CA 100%)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold bg-white/20 px-2 py-0.5 rounded-full">
                    مدیر کلینیک و پزشک ارشد
                  </span>
                  <h3 className="text-sm font-black mt-1">دکتر مهدی امیری</h3>
                  <p className="text-[10px] text-indigo-100" dir="ltr">mehdi.amiri19851364@gmail.com</p>
                </div>
              </div>
              <button
                onClick={() => setTab('doctor_calc')}
                className="px-2.5 py-1.5 rounded-xl bg-white text-indigo-900 text-[11px] font-black shadow-sm haptic"
              >
                سهم‌بندی ۳ مدل ←
              </button>
            </div>
            <div className="qbank-corner-key" style={{ color: '#4F46E5' }}>
              <ArrowUpRight size={13} strokeWidth={2.6} />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<UserCog size={28} />} title="پرسنلی ثبت نشده" color="#6366F1" />
          ) : (
            <div className="space-y-2 stagger">
              {filtered.map(s => {
                const roleLabel = ROLES.find(r => r.value === s.role)?.label ?? s.role;
                const sShares = shares.filter(sh => sh.staff_id === s.id && sh.active);
                return (
                  <div key={s.id} className="glass-card p-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-black text-base shrink-0"
                        style={{ background: s.color || '#6366F1' }}
                      >
                        {s.first_name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-black text-gray-800 truncate">
                            {s.first_name} {s.last_name}
                          </h3>
                          {(s.role === 'dentist' || s.role === 'manager') && (
                            <Stethoscope size={14} className="text-indigo-500" />
                          )}
                          {s.active && <BadgeCheck size={14} className="text-emerald-500" />}
                        </div>
                        <div className="flex items-center flex-wrap gap-1.5 mt-1">
                          <Badge color="#6366F1" bg="#E0E7FF">{roleLabel}</Badge>
                          {sShares.length > 0 && (
                            <Badge color="#10B981" bg="#D1FAE5">
                              <Percent size={9} /> دارای فرمول سهم
                            </Badge>
                          )}
                        </div>
                        {s.phone && (
                          <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1" dir="ltr">
                            <Phone size={11} className="text-indigo-500" /> {s.phone}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          onClick={() => { setEditing(s); setFormOpen(true); }}
                          className="px-3 py-1 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-extrabold haptic"
                        >
                          ویرایش / رمز
                        </button>
                        <button
                          onClick={() => setDeleteId(s.id)}
                          className="px-3 py-1 rounded-xl bg-rose-50 text-rose-500 text-xs font-extrabold haptic"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: 3-Model Doctor Commission & Share Calculator */}
      {tab === 'doctor_calc' && (
        <DoctorShareCalculatorTab
          staff={staff}
          treatments={treatments}
          labOrders={labOrders}
          onGoToSalaries={() => setTab('salaries')}
        />
      )}

      {tab === 'salaries' && <SalariesTab salaries={salaries} staff={staff} finance={finance} />}
      {tab === 'shares' && <SharesTab shares={shares} staff={staff} finance={finance} />}

      <Sheet
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        title={editing ? 'ویرایش پرسنل و دسترسی' : 'ثبت پزشک / پرسنل جدید'}
        icon={<UserCog size={20} />}
        color="#6366F1"
      >
        <StaffForm staff={editing} onSave={handleSave} saving={saving} />
      </Sheet>
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="حذف پرسنل"
        message="آیا از حذف این پرسنل اطمینان دارید؟"
        confirmLabel="حذف"
      />
    </div>
  );
}

// ==================== 3-MODEL DOCTOR COMMISSION ENGINE ====================
function DoctorShareCalculatorTab({
  staff,
  treatments,
  labOrders,
  onGoToSalaries,
}: {
  staff: Staff[];
  treatments: Treatment[];
  labOrders: LabOrder[];
  onGoToSalaries: () => void;
}) {
  const doctors = useMemo(
    () => staff.filter(s => s.role === 'dentist' || s.role === 'manager'),
    [staff]
  );

  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(doctors[0]?.id || 'manager_mehdi');
  const [modelType, setModelType] = useState<'formula_half_net' | 'fixed_per_procedure' | 'custom_percentage'>('formula_half_net');
  const [fixedPerProcedure, setFixedPerProcedure] = useState<number>(1500000);
  const [customPercent, setCustomPercent] = useState<number>(55);
  const [managerSpecialPercent, setManagerSpecialPercent] = useState<number>(100);
  const [savingPayroll, setSavingPayroll] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const isManagerSelected =
    selectedDoctorId === 'manager_mehdi' ||
    doctors.find(d => d.id === selectedDoctorId)?.role === 'manager' ||
    doctors.find(d => d.id === selectedDoctorId)?.last_name?.includes('امیری');

  const grossRevenue = useMemo(
    () => treatments.reduce((sum, t) => sum + Number(t.total_cost || 0), 0),
    [treatments]
  );

  const totalLabCost = useMemo(() => {
    const fromTreatments = treatments.reduce((sum, t) => sum + Number(t.lab_cost || 0), 0);
    const fromOrders = labOrders.reduce((sum, l) => sum + Number(l.cost || 0), 0);
    return Math.max(fromTreatments, fromOrders);
  }, [treatments, labOrders]);

  const netAfterLab = Math.max(0, grossRevenue - totalLabCost);
  const procedureCount = Math.max(1, treatments.length);

  // Model 1: (Total Work - Total Lab Cost) / 2
  const model1Share = Math.round(netAfterLab / 2);

  // Model 2: Fixed Wage per Surgery/Treatment
  const model2Share = Math.round(procedureCount * (Number(fixedPerProcedure) || 0));

  // Model 3: Custom Percentage (with special percentage for Manager Dr. Mehdi Amiri)
  const effectivePercent = isManagerSelected ? managerSpecialPercent : customPercent;
  const model3Share = Math.round((netAfterLab * effectivePercent) / 100);

  const activeCalculatedShare =
    modelType === 'formula_half_net'
      ? model1Share
      : modelType === 'fixed_per_procedure'
      ? model2Share
      : model3Share;

  const clinicRemainingShare = Math.max(0, netAfterLab - activeCalculatedShare);

  const handleRecordToSalary = async () => {
    setSavingPayroll(true);
    const jNow = dateStrToJalali(todayGregorian());
    const targetStaffId = doctors.find(d => d.id === selectedDoctorId)?.id || staff[0]?.id;
    if (targetStaffId) {
      await supabase.from('staff_salaries').insert({
        staff_id: targetStaffId,
        base_salary: 0,
        bonus: 0,
        deductions: 0,
        share_amount: activeCalculatedShare,
        total_paid: 0,
        pay_month: jNow.jm,
        pay_year: jNow.jy,
        status: 'pending',
        notes: `سهم پزشک (${
          modelType === 'formula_half_net'
            ? 'فرمول کارکرد منهای لابراتوار تقسیم بر ۲'
            : modelType === 'fixed_per_procedure'
            ? `دستمزد ثابت هر درمان (${procedureCount} مورد)`
            : `درصد اختصاصی (${effectivePercent}%)`
        })`,
      });
    }
    setSavingPayroll(false);
    setSavedNotice('سهم محاسبه‌شده با موفقیت در لیست حقوق ماه جاری ثبت شد');
    setTimeout(() => {
      setSavedNotice(null);
      onGoToSalaries();
    }, 1800);
  };

  return (
    <div className="space-y-2.5 animate-fade-in">
      <div className="glass-card p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
              <Calculator size={16} className="text-indigo-600" />
              موتور هوشمند محاسبه سهم پزشک (۳ مدل استاندارد)
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              محاسبه زنده بر اساس کل کارکرد، کسر هزینه لابراتوار، دستمزد ثابت و درصد ویژه مدیر
            </p>
          </div>
          <Badge color="#4F46E5" bg="#E0E7FF">زنده</Badge>
        </div>

        {/* Doctor Selector including Manager Dr. Mehdi Amiri */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          <button
            onClick={() => setSelectedDoctorId('manager_mehdi')}
            className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap shrink-0 transition-all ${
              selectedDoctorId === 'manager_mehdi'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-indigo-50 text-indigo-700'
            }`}
          >
            👑 دکتر مهدی امیری (مدیر کلینیک)
          </button>
          {doctors.map(doc => (
            <button
              key={doc.id}
              onClick={() => setSelectedDoctorId(doc.id)}
              className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap shrink-0 transition-all ${
                selectedDoctorId === doc.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              دکتر {doc.first_name} {doc.last_name}
            </button>
          ))}
        </div>

        {/* Live Gross / Lab / Net Summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-slate-50 p-2 border border-slate-200">
            <p className="text-[9.5px] font-bold text-gray-500">کل کارکرد درمان‌ها</p>
            <p className="text-xs font-black text-slate-800 mt-0.5">{grossRevenue.toLocaleString('fa-IR')} ت</p>
          </div>
          <div className="rounded-2xl bg-rose-50/70 p-2 border border-rose-200">
            <p className="text-[9.5px] font-bold text-rose-600">کسر هزینه لابراتوار</p>
            <p className="text-xs font-black text-rose-700 mt-0.5">−{totalLabCost.toLocaleString('fa-IR')} ت</p>
          </div>
          <div className="rounded-2xl bg-emerald-50/80 p-2 border border-emerald-200">
            <p className="text-[9.5px] font-bold text-emerald-700">خالص قابل تسهیم</p>
            <p className="text-xs font-black text-emerald-800 mt-0.5">{netAfterLab.toLocaleString('fa-IR')} ت</p>
          </div>
        </div>

        {/* 3 Model Selector Cards */}
        <div className="space-y-2">
          {/* MODEL 1 */}
          <div
            onClick={() => setModelType('formula_half_net')}
            className={`cursor-pointer rounded-2xl p-3 border-2 transition-all ${
              modelType === 'formula_half_net'
                ? 'border-indigo-600 bg-indigo-50/60'
                : 'border-gray-100 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black text-slate-800">
                  راه اول: (کل کارکرد − کل هزینه لابراتوار) ÷ ۲
                </p>
                <p className="text-[10.5px] text-gray-500 mt-0.5">
                  تسهیم ۵۰/۵۰ خالص کارکرد پس از کسر کامل هزینه لابراتوار
                </p>
              </div>
              <span className="text-sm font-black text-indigo-700">
                {model1Share.toLocaleString('fa-IR')} ت
              </span>
            </div>
          </div>

          {/* MODEL 2 */}
          <div
            onClick={() => setModelType('fixed_per_procedure')}
            className={`cursor-pointer rounded-2xl p-3 border-2 transition-all ${
              modelType === 'fixed_per_procedure'
                ? 'border-indigo-600 bg-indigo-50/60'
                : 'border-gray-100 bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-black text-slate-800">
                  راه دوم: دستمزد ثابت هر جراحی یا درمان (ثبت دستی)
                </p>
                <p className="text-[10.5px] text-gray-500 mt-0.5">
                  تعداد درمان ثبت‌شده: {procedureCount.toLocaleString('fa-IR')} مورد
                </p>
              </div>
              <span className="text-sm font-black text-indigo-700">
                {model2Share.toLocaleString('fa-IR')} ت
              </span>
            </div>
            {modelType === 'fixed_per_procedure' && (
              <Field label="مبلغ دستمزد ثابت هر جراحی / درمان (تومان)">
                <Input
                  type="number"
                  value={fixedPerProcedure}
                  onChange={e => setFixedPerProcedure(Number(e.target.value))}
                  placeholder="مثلاً 1500000"
                />
              </Field>
            )}
          </div>

          {/* MODEL 3 */}
          <div
            onClick={() => setModelType('custom_percentage')}
            className={`cursor-pointer rounded-2xl p-3 border-2 transition-all ${
              modelType === 'custom_percentage'
                ? 'border-indigo-600 bg-indigo-50/60'
                : 'border-gray-100 bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-black text-slate-800">
                  راه سوم: درصدی اختصاصی هر پزشک (ویژه مدیر: دکتر مهدی امیری)
                </p>
                <p className="text-[10.5px] text-gray-500 mt-0.5">
                  درصد فعلی این پزشک: {effectivePercent.toLocaleString('fa-IR')}٪ از خالص کارکرد
                </p>
              </div>
              <span className="text-sm font-black text-indigo-700">
                {model3Share.toLocaleString('fa-IR')} ت
              </span>
            </div>
            {modelType === 'custom_percentage' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Field label="درصد اختصاصی پزشکان همکار (%)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={customPercent}
                    onChange={e => setCustomPercent(Number(e.target.value))}
                  />
                </Field>
                <Field label="درصد ویژه دکتر مهدی امیری (مدیر %)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={managerSpecialPercent}
                    onChange={e => setManagerSpecialPercent(Number(e.target.value))}
                  />
                </Field>
              </div>
            )}
          </div>
        </div>

        {/* Final Share Summary & Save Button */}
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-700 p-3.5 text-white flex items-center justify-between">
          <div>
            <p className="text-[10px] text-indigo-100">سهم نهایی قابل پرداخت پزشک:</p>
            <p className="text-lg font-black">{activeCalculatedShare.toLocaleString('fa-IR')} تومان</p>
            <p className="text-[10px] text-indigo-200 mt-0.5">
              سهم باقی‌مانده مطب: {clinicRemainingShare.toLocaleString('fa-IR')} تومان
            </p>
          </div>
          <button
            onClick={handleRecordToSalary}
            disabled={savingPayroll}
            className="px-3.5 py-2 rounded-xl bg-white text-indigo-900 text-xs font-black shadow-md haptic"
          >
            {savingPayroll ? 'در حال ثبت...' : 'ثبت در فیش حقوقی'}
          </button>
        </div>

        {savedNotice && (
          <p className="text-xs font-bold text-emerald-700 bg-emerald-50 p-2.5 rounded-xl text-center">
            {savedNotice}
          </p>
        )}
      </div>
    </div>
  );
}

function StaffForm({
  staff,
  onSave,
  saving,
}: {
  staff: Staff | null;
  onSave: (d: Partial<Staff> & { pinOrPass?: string }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    first_name: staff?.first_name ?? '',
    last_name: staff?.last_name ?? '',
    role: staff?.role ?? 'secretary',
    phone: staff?.phone ?? '',
    email: staff?.email ?? '',
    color: staff?.color ?? '#6366F1',
    active: staff?.active ?? true,
    pinOrPass: '1234',
  });
  const submit = () => {
    if (!form.first_name.trim()) return;
    onSave(form);
  };
  const colors = ['#6366F1','#3B82F6','#10B981','#F59E0B','#EC4899','#06B6D4','#8B5CF6','#EF4444'];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="نام *">
          <Input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} placeholder="نام" />
        </Field>
        <Field label="نام خانوادگی">
          <Input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} placeholder="نام خانوادگی" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="نقش و سطح دسترسی">
          <Select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} options={ROLES} />
        </Field>
        <Field label="رمز عبور / PIN ورود">
          <Input type="password" value={form.pinOrPass} onChange={e => setForm({ ...form, pinOrPass: e.target.value })} placeholder="رمز ورود اختصاصی" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="شماره موبایل (جهت ورود و سینک)">
          <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0912..." />
        </Field>
        <Field label="جیمیل (جهت سینک آنی بین پلتفرم‌ها)">
          <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="example@gmail.com" />
        </Field>
      </div>
      <div className="p-3 rounded-2xl bg-indigo-50/70 border border-indigo-100 text-xs space-y-1">
        <p className="font-black text-indigo-900">قوانین امنیتی و سطح دسترسی این نقش:</p>
        <p className="text-gray-600 leading-relaxed">
          {form.role === 'manager' && '👑 مدیر کلینیک (دکتر مهدی امیری): دسترسی کامل به تغییر قیمت‌ها پس از ثبت، سهم‌بندی‌ها، بکاپ ابری/گوگل درایو و تمام بخش‌ها.'}
          {form.role === 'dentist' && '🦷 پزشک: مشاهده آنی بیماران ثبت‌شده توسط منشی، ثبت درمان روی چارت پالمر و سینک لحظه‌ای در همه پلتفرم‌ها.'}
          {form.role === 'secretary' && '📋 منشی: تشکیل پرونده بیمار، نوبت‌دهی و ثبت اولیه (تغییر قیمت پس از ثبت و حذف اطلاعات حیاتی قفل است).'}
          {form.role === 'assistant' && '📦 دستیار: مدیریت انبار، آمادهسازی یونیت و پیگیری مراحل لابراتوار و ایمپلنت.'}
        </p>
      </div>
      <Field label="رنگ شناسایی پرسنل">
        <div className="flex gap-2 flex-wrap">
          {colors.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setForm({ ...form, color: c })}
              className="w-8 h-8 rounded-full haptic transition-transform"
              style={{
                background: c,
                border: form.color === c ? '3px solid #1e1e2e' : 'none',
                transform: form.color === c ? 'scale(1.15)' : 'scale(1)',
              }}
            />
          ))}
        </div>
      </Field>
      <Button onClick={submit} color="#6366F1" disabled={saving} className="w-full">
        {saving ? 'در حال ذخیره و سینک...' : 'ذخیره اکانت، جیمیل و رمز عبور'}
      </Button>
    </div>
  );
}

// ==================== SALARIES TAB ====================
function SalariesTab({ salaries, staff }: { salaries: StaffSalary[]; staff: Staff[]; finance: FinanceTransaction[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ staff_id: '', base_salary: '', bonus: '', deductions: '', notes: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const jNow = dateStrToJalali(todayGregorian());
  const currentMonth = jNow.jm;
  const currentYear = jNow.jy;

  const thisMonthSalaries = salaries.filter(s => s.pay_month === currentMonth && s.pay_year === currentYear);
  const totalPayroll = thisMonthSalaries.reduce(
    (s, sal) => s + Number(sal.base_salary) + Number(sal.bonus) - Number(sal.deductions) + Number(sal.share_amount),
    0
  );

  const save = async () => {
    if (!form.staff_id) return;
    setSaving(true);
    await supabase.from('staff_salaries').insert({
      staff_id: form.staff_id,
      base_salary: Number(form.base_salary) || 0,
      bonus: Number(form.bonus) || 0,
      deductions: Number(form.deductions) || 0,
      total_paid: 0,
      share_amount: 0,
      pay_month: currentMonth,
      pay_year: currentYear,
      status: 'pending',
      notes: form.notes || null,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ staff_id: '', base_salary: '', bonus: '', deductions: '', notes: '' });
  };

  const paySalary = async (sal: StaffSalary) => {
    const total = Number(sal.base_salary) + Number(sal.bonus) - Number(sal.deductions) + Number(sal.share_amount);
    await supabase.from('staff_salaries').update({ status: 'paid', total_paid: total, pay_date: todayGregorian() }).eq('id', sal.id);
    await supabase.from('finance_transactions').insert({
      type: 'expense',
      category: 'salary',
      amount: total,
      transaction_date: todayGregorian(),
      description: `حقوق ${faMonths[sal.pay_month - 1]} ${sal.pay_year}`,
      payment_method: 'transfer',
    });
  };
  const del = async (id: string) => {
    await supabase.from('staff_salaries').delete().eq('id', id);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="glass-card p-4" style={{ borderTop: '3px solid #6366F1' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">جمع حقوق و سهم پزشکان این ماه</p>
            <p className="text-2xl font-black text-indigo-600">{totalPayroll.toLocaleString('fa-IR')} ت</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="w-9 h-9 rounded-xl bg-indigo-500 text-white flex items-center justify-center shadow haptic"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
      <Sheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title={`ثبت حقوق جدید — ${faMonths[currentMonth - 1]} ${currentYear}`}
        icon={<Wallet size={20} />}
        color="#6366F1"
      >
        <div className="space-y-4">
          <Field label="پرسنل">
            <Select
              value={form.staff_id}
              onChange={e => setForm({ ...form, staff_id: e.target.value })}
              options={[{ value: '', label: 'انتخاب...' }, ...staff.map(s => ({ value: s.id, label: `${s.first_name} ${s.last_name}` }))]}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="حقوق پایه">
              <Input type="number" value={form.base_salary} onChange={e => setForm({ ...form, base_salary: e.target.value })} placeholder="0" />
            </Field>
            <Field label="پاداش">
              <Input type="number" value={form.bonus} onChange={e => setForm({ ...form, bonus: e.target.value })} placeholder="0" />
            </Field>
            <Field label="کسورات">
              <Input type="number" value={form.deductions} onChange={e => setForm({ ...form, deductions: e.target.value })} placeholder="0" />
            </Field>
          </div>
          <Button color="#6366F1" disabled={saving || !form.staff_id} className="w-full" onClick={save}>
            {saving ? 'در حال ذخیره...' : 'ثبت حقوق'}
          </Button>
        </div>
      </Sheet>
      {thisMonthSalaries.length === 0 ? (
        <EmptyState icon={<Wallet size={28} />} title="حقوقی برای این ماه ثبت نشده" color="#6366F1" />
      ) : (
        thisMonthSalaries.map(sal => {
          const s = staff.find(st => st.id === sal.staff_id);
          const total = Number(sal.base_salary) + Number(sal.bonus) - Number(sal.deductions) + Number(sal.share_amount);
          const status = SALARY_STATUS[sal.status] ?? SALARY_STATUS.pending;
          return (
            <div key={sal.id} className="glass-card p-3.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-black text-gray-800">{s ? `${s.first_name} ${s.last_name}` : 'دکتر مهدی امیری / پزشک'}</p>
                <div className="flex items-center gap-2">
                  <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                  <button
                    onClick={() => setDeleteId(sal.id)}
                    className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 haptic"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                <div>
                  <p className="text-gray-400">پایه</p>
                  <p className="font-bold text-gray-700">{Number(sal.base_salary).toLocaleString('fa-IR')}</p>
                </div>
                <div>
                  <p className="text-gray-400">پاداش</p>
                  <p className="font-bold text-green-500">+{Number(sal.bonus).toLocaleString('fa-IR')}</p>
                </div>
                <div>
                  <p className="text-gray-400">کسور</p>
                  <p className="font-bold text-red-500">-{Number(sal.deductions).toLocaleString('fa-IR')}</p>
                </div>
              </div>
              {Number(sal.share_amount) > 0 && (
                <p className="text-xs font-extrabold text-indigo-600 mb-1">
                  سهم کارکرد پزشک: +{Number(sal.share_amount).toLocaleString('fa-IR')} ت
                </p>
              )}
              {sal.notes && <p className="text-[11px] text-gray-500 mb-2">{sal.notes}</p>}
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className="text-sm font-black text-indigo-600">{total.toLocaleString('fa-IR')} ت</span>
                {sal.status === 'pending' && (
                  <button
                    onClick={() => paySalary(sal)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-extrabold haptic"
                  >
                    <CheckCircle2 size={14} /> ثبت پرداخت
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && del(deleteId)}
        title="حذف رکورد حقوق"
        message="آیا مطمئن هستید؟"
        confirmLabel="حذف"
      />
    </div>
  );
}

// ==================== SHARES TAB ====================
function SharesTab({ shares, staff }: { shares: StaffShare[]; staff: Staff[]; finance: FinanceTransaction[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    staff_id: '',
    share_type: 'percentage',
    share_value: '',
    applies_to: 'treatment',
    min_amount: '',
    notes: '',
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const save = async () => {
    if (!form.staff_id || !form.share_value) return;
    setSaving(true);
    await supabase.from('staff_shares').insert({
      staff_id: form.staff_id,
      share_type: form.share_type as 'percentage' | 'fixed',
      share_value: Number(form.share_value),
      applies_to: form.applies_to,
      min_amount: Number(form.min_amount) || 0,
      active: true,
      notes: form.notes || null,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ staff_id: '', share_type: 'percentage', share_value: '', applies_to: 'treatment', min_amount: '', notes: '' });
  };
  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from('staff_shares').update({ active: !active }).eq('id', id);
  };
  const del = async (id: string) => {
    await supabase.from('staff_shares').delete().eq('id', id);
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <Percent size={16} className="text-indigo-500" /> قوانین سهم‌بندی درآمد پزشکان
        </h3>
        <button
          onClick={() => setShowForm(true)}
          className="w-9 h-9 rounded-xl bg-indigo-500 text-white flex items-center justify-center shadow haptic"
        >
          <Plus size={20} />
        </button>
      </div>
      <Sheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="قانون سهم‌بندی جدید"
        icon={<Percent size={20} />}
        color="#6366F1"
      >
        <div className="space-y-4">
          <Field label="پرسنل / پزشک">
            <Select
              value={form.staff_id}
              onChange={e => setForm({ ...form, staff_id: e.target.value })}
              options={[{ value: '', label: 'انتخاب...' }, ...staff.map(s => ({ value: s.id, label: `${s.first_name} ${s.last_name}` }))]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="مدل سهم">
              <Select
                value={form.share_type}
                onChange={e => setForm({ ...form, share_type: e.target.value })}
                options={[
                  { value: 'percentage', label: 'درصدی از کارکرد' },
                  { value: 'fixed', label: 'مبلغ ثابت هر درمان/جراحی' },
                ]}
              />
            </Field>
            <Field label="مقدار (درصد یا مبلغ)">
              <Input
                type="number"
                value={form.share_value}
                onChange={e => setForm({ ...form, share_value: e.target.value })}
                placeholder={form.share_type === 'percentage' ? 'مثلاً 50' : 'مثلاً 1500000'}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="اعمال روی">
              <Select value={form.applies_to} onChange={e => setForm({ ...form, applies_to: e.target.value })} options={SHARE_APPLIES} />
            </Field>
            <Field label="حداقل مبلغ">
              <Input type="number" value={form.min_amount} onChange={e => setForm({ ...form, min_amount: e.target.value })} placeholder="اختیاری" />
            </Field>
          </div>
          <Button color="#6366F1" disabled={saving || !form.staff_id || !form.share_value} className="w-full" onClick={save}>
            {saving ? 'در حال ذخیره...' : 'ثبت قانون سهم'}
          </Button>
        </div>
      </Sheet>
      {shares.length === 0 ? (
        <EmptyState icon={<Percent size={28} />} title="قانون سهمی تعریف نشده" color="#6366F1" />
      ) : (
        shares.map(sh => {
          const s = staff.find(st => st.id === sh.staff_id);
          const appliesLabel = SHARE_APPLIES.find(a => a.value === sh.applies_to)?.label ?? sh.applies_to;
          return (
            <div key={sh.id} className="glass-card p-3.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-black text-gray-800">{s ? `${s.first_name} ${s.last_name}` : 'نامشخص'}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActive(sh.id, sh.active)}
                    className={`badge haptic ${sh.active ? '' : 'opacity-50'}`}
                    style={{ color: sh.active ? '#22C55E' : '#9CA3AF', background: sh.active ? '#DCFCE7' : '#F3F4F6' }}
                  >
                    {sh.active ? 'فعال' : 'غیرفعال'}
                  </button>
                  <button
                    onClick={() => setDeleteId(sh.id)}
                    className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 haptic"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-indigo-600 font-black">
                  {sh.share_type === 'percentage' ? `${Number(sh.share_value)}%` : `${Number(sh.share_value).toLocaleString('fa-IR')} ت`}
                </span>
                <span className="text-gray-400">از {appliesLabel}</span>
                {Number(sh.min_amount) > 0 && (
                  <span className="text-gray-400">حداقل: {Number(sh.min_amount).toLocaleString('fa-IR')} ت</span>
                )}
              </div>
              {sh.notes && <p className="text-xs text-gray-500 mt-1">{sh.notes}</p>}
            </div>
          );
        })
      )}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && del(deleteId)}
        title="حذف قانون سهم"
        message="آیا مطمئن هستید؟"
        confirmLabel="حذف"
      />
    </div>
  );
}
