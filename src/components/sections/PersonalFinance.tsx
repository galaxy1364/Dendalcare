import { useState, useMemo, useEffect } from 'react';
import {
  Briefcase, Plus, Search, X, CheckSquare, ShoppingBag,
  FileCheck, Landmark, Home, TrendingUp, TrendingDown,
  CheckCircle2, Clock, Trash2, Calendar, AlertTriangle, Sparkles,
} from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian, jalaliToFa } from '@/lib/jalali';
import { supabase } from '@/lib/supabase';

export type PersonalTaskItem = {
  id: string;
  title: string;
  category: 'bank' | 'clinic_admin' | 'family' | 'investment' | 'other';
  dueDate: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  estimatedCost: number;
  done: boolean;
  notes: string;
};

export type PersonalPurchaseItem = {
  id: string;
  title: string;
  category: 'daily' | 'home' | 'equipment' | 'vehicle' | 'investment' | 'other';
  amount: number;
  vendor: string;
  purchaseDate: string;
  status: 'planned' | 'purchased';
  notes: string;
};

export type PersonalCheckItem = {
  id: string;
  direction: 'issued' | 'received'; // چک صادره شخصی | چک دریافتی شخصی
  counterparty: string;
  bankName: string;
  checkNumber: string;
  sayadId: string;
  amount: number;
  dueDate: string;
  status: 'pending' | 'cleared' | 'bounced';
  notes: string;
};

export type PersonalLoanItem = {
  id: string;
  title: string; // مثلاً وام خرید تجهیزات یا وام مسکن
  bankName: string;
  totalLoanAmount: number;
  monthlyInstallment: number;
  totalInstallments: number;
  paidInstallments: number;
  nextDueDate: string;
  accountOrLoanNo: string;
  status: 'active' | 'completed';
  notes: string;
};

export type PersonalRentLeaseItem = {
  id: string;
  propertyTitle: string; // مثلاً اجاره مطب، اجاره منزل، واحد تجاری
  role: 'tenant' | 'landlord'; // مستاجر (پرداخت‌کننده) | موجر (دریافت‌کننده)
  counterpartyName: string;
  depositAmount: number; // مبلغ رهن / ودیعه
  monthlyRentAmount: number; // مبلغ اجاره ماهانه
  nextRentDueDate: string;
  contractEndDate: string;
  status: 'active' | 'expired';
  notes: string;
};

export type PersonalFinanceData = {
  tasks: PersonalTaskItem[];
  purchases: PersonalPurchaseItem[];
  checks: PersonalCheckItem[];
  loans: PersonalLoanItem[];
  rents: PersonalRentLeaseItem[];
  updatedAt: string;
};

const STORAGE_KEY = 'minadental_personal_finance_v4';

const DEFAULT_PERSONAL_DATA: PersonalFinanceData = {
  tasks: [
    {
      id: 'pt_1',
      title: 'تمدید بیمه مسئولیت حرفه‌ای نظام پزشکی و بیمه مطب',
      category: 'clinic_admin',
      dueDate: todayGregorian(),
      priority: 'urgent',
      estimatedCost: 12500000,
      done: false,
      notes: 'تمدید سالانه آنلاین',
    },
  ],
  purchases: [
    {
      id: 'pp_1',
      title: 'خرید اتوکلاو کلاس B و تجهیزات استریل جدید',
      category: 'equipment',
      amount: 145000000,
      vendor: 'تجهیزات دندانپزشکی پارس',
      purchaseDate: todayGregorian(),
      status: 'planned',
      notes: 'گارانتی ۲۴ ماهه',
    },
  ],
  checks: [],
  loans: [
    {
      id: 'pl_1',
      title: 'وام توسعه تجهیز مطب و یونیت دندانپزشکی',
      bankName: 'بانک ملت',
      totalLoanAmount: 600000000,
      monthlyInstallment: 18500000,
      totalInstallments: 36,
      paidInstallments: 8,
      nextDueDate: todayGregorian(),
      accountOrLoanNo: '402-998124',
      status: 'active',
      notes: 'سررسید بیست‌وپنجم هر ماه',
    },
  ],
  rents: [
    {
      id: 'pr_1',
      propertyTitle: 'اجاره و رهن واحد مطب دندانپزشکی',
      role: 'tenant',
      counterpartyName: 'مالک ساختمان پزشکان',
      depositAmount: 800000000,
      monthlyRentAmount: 35000000,
      nextRentDueDate: todayGregorian(),
      contractEndDate: '2027-03-20',
      status: 'active',
      notes: 'واریز اول هر ماه شمسی',
    },
  ],
  updatedAt: new Date().toISOString(),
};

export function loadPersonalFinanceStore(): PersonalFinanceData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
        checks: Array.isArray(parsed.checks) ? parsed.checks : [],
        loans: Array.isArray(parsed.loans) ? parsed.loans : [],
        rents: Array.isArray(parsed.rents) ? parsed.rents : [],
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_PERSONAL_DATA;
}

export async function savePersonalFinanceStore(next: PersonalFinanceData): Promise<void> {
  const stamped = { ...next, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    window.dispatchEvent(new CustomEvent('minadental-personal-finance-updated', { detail: stamped }));
  } catch {
    // ignore
  }
  // Cloud sync to Supabase clinic_settings
  try {
    const val = JSON.stringify(stamped);
    const { data: existing } = await supabase
      .from('clinic_settings')
      .select('id')
      .eq('key', 'personal_finance_cloud_store')
      .maybeSingle();
    if (existing?.id) {
      await supabase
        .from('clinic_settings')
        .update({ value: val, category: 'personal_finance' })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('clinic_settings')
        .insert({ key: 'personal_finance_cloud_store', value: val, category: 'personal_finance' });
    }
  } catch {
    // ignore offline error
  }
}

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

type PersonalTab = 'overview' | 'tasks' | 'purchases' | 'checks' | 'loans' | 'rents';

export function PersonalFinance() {
  const [store, setStore] = useState<PersonalFinanceData>(() => loadPersonalFinanceStore());
  const [tab, setTab] = useState<PersonalTab>('overview');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Full-Screen Modal States
  const [modalType, setModalType] = useState<'task' | 'purchase' | 'check' | 'loan' | 'rent' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; title: string } | null>(null);

  const today = todayGregorian();

  useEffect(() => {
    // Pull from cloud on mount if newer
    supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', 'personal_finance_cloud_store')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          try {
            const cloudData = JSON.parse(data.value) as PersonalFinanceData;
            if (cloudData.updatedAt && cloudData.updatedAt > store.updatedAt) {
              setStore(cloudData);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudData));
            }
          } catch {
            // ignore
          }
        }
      });
  }, []);

  const updateStore = (updater: (prev: PersonalFinanceData) => PersonalFinanceData) => {
    setStore((prev) => {
      const next = updater(prev);
      savePersonalFinanceStore(next);
      return next;
    });
  };

  // KPIs
  const summary = useMemo(() => {
    const monthlyLoans = store.loans
      .filter((l) => l.status === 'active')
      .reduce((s, l) => s + Number(l.monthlyInstallment || 0), 0);
    const remainingLoanDebt = store.loans
      .filter((l) => l.status === 'active')
      .reduce(
        (s, l) =>
          s +
          Math.max(
            0,
            (Number(l.totalInstallments) - Number(l.paidInstallments)) * Number(l.monthlyInstallment)
          ),
        0
      );
    const monthlyRentOut = store.rents
      .filter((r) => r.status === 'active' && r.role === 'tenant')
      .reduce((s, r) => s + Number(r.monthlyRentAmount || 0), 0);
    const totalDeposits = store.rents
      .filter((r) => r.status === 'active')
      .reduce((s, r) => s + Number(r.depositAmount || 0), 0);
    const pendingIssuedChecks = store.checks
      .filter((c) => c.status === 'pending' && c.direction === 'issued')
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    const plannedPurchases = store.purchases
      .filter((p) => p.status === 'planned')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const openTasks = store.tasks.filter((t) => !t.done).length;

    return {
      monthlyLoans,
      remainingLoanDebt,
      monthlyRentOut,
      totalDeposits,
      pendingIssuedChecks,
      plannedPurchases,
      openTasks,
      totalMonthlyFixedCommitment: monthlyLoans + monthlyRentOut,
    };
  }, [store]);

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const { type, id } = deleteTarget;
    updateStore((prev) => ({
      ...prev,
      tasks: type === 'task' ? prev.tasks.filter((x) => x.id !== id) : prev.tasks,
      purchases: type === 'purchase' ? prev.purchases.filter((x) => x.id !== id) : prev.purchases,
      checks: type === 'check' ? prev.checks.filter((x) => x.id !== id) : prev.checks,
      loans: type === 'loan' ? prev.loans.filter((x) => x.id !== id) : prev.loans,
      rents: type === 'rent' ? prev.rents.filter((x) => x.id !== id) : prev.rents,
    }));
    setDeleteTarget(null);
  };

  const openQuickAddForCurrentTab = () => {
    if (tab === 'tasks') setModalType('task');
    else if (tab === 'purchases') setModalType('purchase');
    else if (tab === 'checks') setModalType('check');
    else if (tab === 'loans') setModalType('loan');
    else if (tab === 'rents') setModalType('rent');
    else setModalType('task');
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Top Header & Sliding Chip Bar */}
      <div className="glass-card p-3.5 border-t-4 border-purple-500">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
              <Briefcase size={20} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-gray-800">
                مدیریت مالی شخصی، وام، چک، رهن و اجاره، خرید و کارها
              </h2>
              <p className="text-[10px] text-gray-500">
                تعهدات ماهانه ثابت: {fmt(summary.totalMonthlyFixedCommitment)} تومان • همگام با تقویم و ابر
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (searchOpen) setSearch('');
              }}
              className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all haptic ${
                searchOpen ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700'
              }`}
            >
              {searchOpen ? <X size={16} /> : <Search size={16} />}
            </button>
            <button
              onClick={openQuickAddForCurrentTab}
              data-testid="personal_finance_new_fullscreen_btn"
              className="px-3.5 h-9 rounded-2xl bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-md haptic"
            >
              <Plus size={16} />
              <span>افزودن مورد جدید</span>
            </button>
          </div>
        </div>

        {/* Sliding Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
          {[
            { id: 'overview' as const, label: 'خلاصه و رادار شخصی', icon: <Sparkles size={13} /> },
            { id: 'loans' as const, label: 'وام و اقساط بانکی', icon: <Landmark size={13} />, count: store.loans.length },
            { id: 'rents' as const, label: 'رهن و اجاره ملک/مطب', icon: <Home size={13} />, count: store.rents.length },
            { id: 'checks' as const, label: 'چک‌های شخصی', icon: <FileCheck size={13} />, count: store.checks.length },
            { id: 'purchases' as const, label: 'خریدها و لیست خرید', icon: <ShoppingBag size={13} />, count: store.purchases.length },
            { id: 'tasks' as const, label: 'کارها و برنامه‌ها', icon: <CheckSquare size={13} />, count: summary.openTasks },
          ].map((c) => {
            const active = tab === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setTab(c.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all haptic ${
                  active
                    ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md scale-[1.02]'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200/70'
                }`}
              >
                {c.icon}
                <span>{c.label}</span>
                {c.count !== undefined && c.count > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                      active ? 'bg-white/25 text-white' : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {jalaliToFa(c.count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {searchOpen && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-100 animate-slide-down">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو در وام‌ها، اجاره‌ها، چک‌های شخصی، خریدها و کارها..."
              className="text-xs"
            />
          </div>
        )}
      </div>

      {/* Quick Action Bar to Open Any Full-Screen Creation Form */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <button
          onClick={() => setModalType('loan')}
          className="glass-card p-2.5 flex items-center justify-center gap-1.5 text-xs font-extrabold text-indigo-700 hover:bg-indigo-50/70 transition-all haptic"
        >
          <Plus size={14} className="text-indigo-600" />
          <span>ثبت وام و قسط</span>
        </button>
        <button
          onClick={() => setModalType('rent')}
          className="glass-card p-2.5 flex items-center justify-center gap-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-50/70 transition-all haptic"
        >
          <Plus size={14} className="text-emerald-600" />
          <span>ثبت رهن و اجاره</span>
        </button>
        <button
          onClick={() => setModalType('check')}
          className="glass-card p-2.5 flex items-center justify-center gap-1.5 text-xs font-extrabold text-amber-700 hover:bg-amber-50/70 transition-all haptic"
        >
          <Plus size={14} className="text-amber-600" />
          <span>ثبت چک شخصی</span>
        </button>
        <button
          onClick={() => setModalType('purchase')}
          className="glass-card p-2.5 flex items-center justify-center gap-1.5 text-xs font-extrabold text-pink-700 hover:bg-pink-50/70 transition-all haptic"
        >
          <Plus size={14} className="text-pink-600" />
          <span>ثبت خرید جدید</span>
        </button>
        <button
          onClick={() => setModalType('task')}
          className="glass-card p-2.5 flex items-center justify-center gap-1.5 text-xs font-extrabold text-purple-700 hover:bg-purple-50/70 transition-all haptic col-span-2 sm:col-span-1"
        >
          <Plus size={14} className="text-purple-600" />
          <span>ثبت کار شخصی</span>
        </button>
      </div>

      {/* OVERVIEW KPI CARDS */}
      {(tab === 'overview' || tab === 'loans' || tab === 'rents') && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="glass-card p-3 border-r-4 border-indigo-500">
            <p className="text-[10px] text-gray-500 font-bold">اقساط ماهانه وام‌ها</p>
            <p className="text-sm font-black text-indigo-700 mt-0.5">{fmt(summary.monthlyLoans)} ت</p>
            <p className="text-[9px] text-gray-400 mt-0.5">مانده کل وام: {fmt(summary.remainingLoanDebt)} ت</p>
          </div>
          <div className="glass-card p-3 border-r-4 border-emerald-500">
            <p className="text-[10px] text-gray-500 font-bold">اجاره ماهانه (مطب/منزل)</p>
            <p className="text-sm font-black text-emerald-700 mt-0.5">{fmt(summary.monthlyRentOut)} ت</p>
            <p className="text-[9px] text-gray-400 mt-0.5">ودیعه/رهن: {fmt(summary.totalDeposits)} ت</p>
          </div>
          <div className="glass-card p-3 border-r-4 border-amber-500">
            <p className="text-[10px] text-gray-500 font-bold">چک‌های شخصی در جریان</p>
            <p className="text-sm font-black text-amber-700 mt-0.5">{fmt(summary.pendingIssuedChecks)} ت</p>
            <p className="text-[9px] text-gray-400 mt-0.5">صادره شخصی</p>
          </div>
          <div className="glass-card p-3 border-r-4 border-pink-500">
            <p className="text-[10px] text-gray-500 font-bold">بودجه خریدهای پیش‌رو</p>
            <p className="text-sm font-black text-pink-700 mt-0.5">{fmt(summary.plannedPurchases)} ت</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{jalaliToFa(summary.openTasks)} کار شخصی باز</p>
          </div>
        </div>
      )}

      {/* 1. BANK LOANS & INSTALLMENTS */}
      {(tab === 'overview' || tab === 'loans') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
              <Landmark size={15} className="text-indigo-600" />
              وام‌های بانکی و تسهیلات ({jalaliToFa(store.loans.length)})
            </h3>
            <button
              onClick={() => setModalType('loan')}
              className="text-[11px] font-bold text-indigo-600 hover:underline"
            >
              + وام جدید
            </button>
          </div>
          {store.loans.length === 0 ? (
            <EmptyState icon={<Landmark size={26} />} title="وامی ثبت نشده است" color="#6366F1" />
          ) : (
            store.loans
              .filter((l) => !search || l.title.includes(search) || l.bankName.includes(search))
              .map((loan) => {
                const pct = Math.min(
                  100,
                  Math.round((loan.paidInstallments / Math.max(1, loan.totalInstallments)) * 100)
                );
                const remainingCount = Math.max(0, loan.totalInstallments - loan.paidInstallments);
                const remainingAmount = remainingCount * Number(loan.monthlyInstallment);
                return (
                  <div key={loan.id} className="glass-card p-3.5 space-y-2 border-r-4 border-indigo-500">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-extrabold text-gray-800">{loan.title}</p>
                        <p className="text-[11px] text-gray-500">
                          {loan.bankName} {loan.accountOrLoanNo ? `• ش.تسهیلات: ${loan.accountOrLoanNo}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          color={loan.status === 'completed' ? '#22C55E' : '#4F46E5'}
                          bg={loan.status === 'completed' ? '#DCFCE7' : '#E0E7FF'}
                        >
                          {loan.status === 'completed' ? 'تسویه‌شده' : `قسط ${jalaliToFa(loan.paidInstallments)} از ${jalaliToFa(loan.totalInstallments)}`}
                        </Badge>
                        <button
                          onClick={() => setDeleteTarget({ type: 'loan', id: loan.id, title: loan.title })}
                          className="w-7 h-7 rounded-lg bg-gray-100 text-gray-400 hover:text-red-500 flex items-center justify-center"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="prog-track h-2">
                      <div
                        className="prog-fill"
                        style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#6366F1,#A855F7)' }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between text-xs text-gray-600 gap-2">
                      <span>
                        قسط ماهانه: <b className="text-indigo-700">{fmt(loan.monthlyInstallment)} ت</b>
                      </span>
                      <span>
                        مانده وام: <b className="text-rose-600">{fmt(remainingAmount)} ت</b> ({jalaliToFa(remainingCount)} قسط)
                      </span>
                      <span>سررسید بعدی: <b>{toJalaliStr(loan.nextDueDate)}</b></span>
                    </div>

                    {loan.status === 'active' && remainingCount > 0 && (
                      <button
                        onClick={() => {
                          updateStore((prev) => ({
                            ...prev,
                            loans: prev.loans.map((item) => {
                              if (item.id !== loan.id) return item;
                              const nextPaid = item.paidInstallments + 1;
                              const nextDate = new Date(item.nextDueDate || today);
                              nextDate.setMonth(nextDate.getMonth() + 1);
                              return {
                                ...item,
                                paidInstallments: nextPaid,
                                status: nextPaid >= item.totalInstallments ? 'completed' : 'active',
                                nextDueDate: nextDate.toISOString().slice(0, 10),
                              };
                            }),
                          }));
                        }}
                        className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow haptic"
                      >
                        <CheckCircle2 size={14} />
                        <span>ثبت پرداخت قسط شماره {jalaliToFa(loan.paidInstallments + 1)} ({fmt(loan.monthlyInstallment)} ت)</span>
                      </button>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}

      {/* 2. RENT & LEASE CONTRACTS (رهن و اجاره) */}
      {(tab === 'overview' || tab === 'rents') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
              <Home size={15} className="text-emerald-600" />
              قراردادهای رهن و اجاره مطب و املاک ({jalaliToFa(store.rents.length)})
            </h3>
            <button
              onClick={() => setModalType('rent')}
              className="text-[11px] font-bold text-emerald-600 hover:underline"
            >
              + قرارداد رهن/اجاره جدید
            </button>
          </div>
          {store.rents.length === 0 ? (
            <EmptyState icon={<Home size={26} />} title="قرارداد رهن و اجاره‌ای ثبت نشده" color="#10B981" />
          ) : (
            store.rents
              .filter((r) => !search || r.propertyTitle.includes(search) || r.counterpartyName.includes(search))
              .map((rent) => (
                <div key={rent.id} className="glass-card p-3.5 space-y-2 border-r-4 border-emerald-500">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-extrabold text-gray-800">{rent.propertyTitle}</p>
                      <p className="text-[11px] text-gray-500">
                        طرف قرارداد: {rent.counterpartyName || '—'} • نقش:{' '}
                        {rent.role === 'tenant' ? 'مستاجر (پرداخت اجاره)' : 'موجر (دریافت اجاره)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge color="#059669" bg="#D1FAE5">
                        اجاره: {fmt(rent.monthlyRentAmount)} ت
                      </Badge>
                      <button
                        onClick={() => setDeleteTarget({ type: 'rent', id: rent.id, title: rent.propertyTitle })}
                        className="w-7 h-7 rounded-lg bg-gray-100 text-gray-400 hover:text-red-500 flex items-center justify-center"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] bg-emerald-50/60 p-2 rounded-xl border border-emerald-100">
                    <div>
                      <span className="text-gray-400 block text-[9px]">مبلغ رهن / ودیعه</span>
                      <b className="text-gray-800">{fmt(rent.depositAmount)} ت</b>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px]">سررسید اجاره بعدی</span>
                      <b className="text-emerald-700">{toJalaliStr(rent.nextRentDueDate)}</b>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px]">پایان قرارداد</span>
                      <b className="text-gray-800">{toJalaliStr(rent.contractEndDate)}</b>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      updateStore((prev) => ({
                        ...prev,
                        rents: prev.rents.map((r) => {
                          if (r.id !== rent.id) return r;
                          const nextD = new Date(r.nextRentDueDate || today);
                          nextD.setMonth(nextD.getMonth() + 1);
                          return { ...r, nextRentDueDate: nextD.toISOString().slice(0, 10) };
                        }),
                      }));
                    }}
                    className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow haptic"
                  >
                    <CheckCircle2 size={14} />
                    <span>ثبت تسویه اجاره این ماه و انتقال سررسید به ماه بعد</span>
                  </button>
                </div>
              ))
          )}
        </div>
      )}

      {/* 3. PERSONAL CHECKS */}
      {(tab === 'overview' || tab === 'checks') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
              <FileCheck size={15} className="text-amber-600" />
              چک‌های شخصی صادره و دریافتی ({jalaliToFa(store.checks.length)})
            </h3>
            <button
              onClick={() => setModalType('check')}
              className="text-[11px] font-bold text-amber-600 hover:underline"
            >
              + چک شخصی جدید
            </button>
          </div>
          {store.checks.length === 0 ? (
            <EmptyState icon={<FileCheck size={26} />} title="چک شخصی ثبت نشده است" color="#F59E0B" />
          ) : (
            store.checks
              .filter((c) => !search || c.counterparty.includes(search) || c.bankName.includes(search))
              .map((chk) => (
                <div key={chk.id} className="glass-card p-3.5 space-y-2 border-r-4 border-amber-500">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-extrabold text-gray-800">
                        {chk.direction === 'issued' ? 'چک صادره به: ' : 'چک دریافتی از: '}
                        {chk.counterparty}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        بانک {chk.bankName} • شماره چک: {chk.checkNumber || '—'}{' '}
                        {chk.sayadId ? `• صیاد: ${chk.sayadId}` : ''}
                      </p>
                    </div>
                    <Badge
                      color={chk.status === 'cleared' ? '#22C55E' : '#D97706'}
                      bg={chk.status === 'cleared' ? '#DCFCE7' : '#FEF3C7'}
                    >
                      {chk.status === 'cleared' ? 'پاس‌شده' : 'در انتظار سررسید'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-black text-amber-700">{fmt(chk.amount)} تومان</span>
                    <span className="text-xs text-gray-500">سررسید: {toJalaliStr(chk.dueDate)}</span>
                    <div className="flex items-center gap-1.5">
                      {chk.status === 'pending' && (
                        <button
                          onClick={() =>
                            updateStore((prev) => ({
                              ...prev,
                              checks: prev.checks.map((c) =>
                                c.id === chk.id ? { ...c, status: 'cleared' } : c
                              ),
                            }))
                          }
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold"
                        >
                          پاس شد
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTarget({ type: 'check', id: chk.id, title: chk.counterparty })}
                        className="w-7 h-7 rounded-lg bg-gray-100 text-gray-400 hover:text-red-500 flex items-center justify-center"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* 4. PURCHASES & SHOPPING */}
      {(tab === 'overview' || tab === 'purchases') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
              <ShoppingBag size={15} className="text-pink-600" />
              خریدها و لیست خرید شخصی/سرمایه‌ای ({jalaliToFa(store.purchases.length)})
            </h3>
            <button
              onClick={() => setModalType('purchase')}
              className="text-[11px] font-bold text-pink-600 hover:underline"
            >
              + خرید جدید
            </button>
          </div>
          {store.purchases.length === 0 ? (
            <EmptyState icon={<ShoppingBag size={26} />} title="خریدی ثبت نشده است" color="#EC4899" />
          ) : (
            store.purchases
              .filter((p) => !search || p.title.includes(search) || p.vendor.includes(search))
              .map((pur) => (
                <div key={pur.id} className="glass-card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-800 truncate">{pur.title}</p>
                    <p className="text-[11px] text-gray-500">
                      {pur.vendor || 'فروشگاه'} • {toJalaliStr(pur.purchaseDate)}
                    </p>
                  </div>
                  <div className="text-left shrink-0 flex items-center gap-2">
                    <div>
                      <p className="text-xs font-black text-pink-600">{fmt(pur.amount)} ت</p>
                      <button
                        onClick={() =>
                          updateStore((prev) => ({
                            ...prev,
                            purchases: prev.purchases.map((x) =>
                              x.id === pur.id
                                ? { ...x, status: x.status === 'purchased' ? 'planned' : 'purchased' }
                                : x
                            ),
                          }))
                        }
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          pur.status === 'purchased'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {pur.status === 'purchased' ? 'خریداری شد ✓' : 'در لیست خرید'}
                      </button>
                    </div>
                    <button
                      onClick={() => setDeleteTarget({ type: 'purchase', id: pur.id, title: pur.title })}
                      className="w-7 h-7 rounded-lg bg-gray-100 text-gray-400 hover:text-red-500 flex items-center justify-center"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* 5. PERSONAL TASKS & TO-DOS */}
      {(tab === 'overview' || tab === 'tasks') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
              <CheckSquare size={15} className="text-purple-600" />
              کارها و برنامه‌های شخصی ({jalaliToFa(store.tasks.length)})
            </h3>
            <button
              onClick={() => setModalType('task')}
              className="text-[11px] font-bold text-purple-600 hover:underline"
            >
              + کار جدید
            </button>
          </div>
          {store.tasks.length === 0 ? (
            <EmptyState icon={<CheckSquare size={26} />} title="کار شخصی ثبت نشده است" color="#8B5CF6" />
          ) : (
            store.tasks
              .filter((t) => !search || t.title.includes(search))
              .map((task) => (
                <div key={task.id} className="glass-card p-3 flex items-center justify-between gap-3">
                  <button
                    onClick={() =>
                      updateStore((prev) => ({
                        ...prev,
                        tasks: prev.tasks.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)),
                      }))
                    }
                    className="flex items-center gap-2.5 flex-1 text-right min-w-0"
                  >
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        task.done ? 'bg-emerald-500 text-white' : 'border-2 border-purple-400 text-transparent'
                      }`}
                    >
                      <CheckCircle2 size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-bold truncate ${
                          task.done ? 'line-through text-gray-400' : 'text-gray-800'
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        موعد: {toJalaliStr(task.dueDate)}
                        {task.estimatedCost > 0 ? ` • هزینه: ${fmt(task.estimatedCost)} ت` : ''}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ type: 'task', id: task.id, title: task.title })}
                    className="w-7 h-7 rounded-lg bg-gray-100 text-gray-400 hover:text-red-500 flex items-center justify-center shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
          )}
        </div>
      )}

      {/* FULL-SCREEN MODALS FOR ALL 5 PERSONAL FINANCE DOMAINS */}
      <Sheet
        open={modalType === 'loan'}
        onClose={() => setModalType(null)}
        title="ثبت وام بانکی و اقساط جدید (فول‌اسکرین)"
        icon={<Landmark size={20} />}
        color="#6366F1"
      >
        <NewLoanForm
          onSave={(loan) => {
            updateStore((prev) => ({ ...prev, loans: [loan, ...prev.loans] }));
            setModalType(null);
          }}
        />
      </Sheet>

      <Sheet
        open={modalType === 'rent'}
        onClose={() => setModalType(null)}
        title="ثبت قرارداد رهن و اجاره جدید (فول‌اسکرین)"
        icon={<Home size={20} />}
        color="#10B981"
      >
        <NewRentForm
          onSave={(rent) => {
            updateStore((prev) => ({ ...prev, rents: [rent, ...prev.rents] }));
            setModalType(null);
          }}
        />
      </Sheet>

      <Sheet
        open={modalType === 'check'}
        onClose={() => setModalType(null)}
        title="ثبت چک شخصی صادره / دریافتی (فول‌اسکرین)"
        icon={<FileCheck size={20} />}
        color="#F59E0B"
      >
        <NewPersonalCheckForm
          onSave={(chk) => {
            updateStore((prev) => ({ ...prev, checks: [chk, ...prev.checks] }));
            setModalType(null);
          }}
        />
      </Sheet>

      <Sheet
        open={modalType === 'purchase'}
        onClose={() => setModalType(null)}
        title="ثبت خرید شخصی / تجهیزات جدید (فول‌اسکرین)"
        icon={<ShoppingBag size={20} />}
        color="#EC4899"
      >
        <NewPurchaseForm
          onSave={(pur) => {
            updateStore((prev) => ({ ...prev, purchases: [pur, ...prev.purchases] }));
            setModalType(null);
          }}
        />
      </Sheet>

      <Sheet
        open={modalType === 'task'}
        onClose={() => setModalType(null)}
        title="ثبت کار و برنامه شخصی جدید (فول‌اسکرین)"
        icon={<CheckSquare size={20} />}
        color="#8B5CF6"
      >
        <NewTaskForm
          onSave={(tsk) => {
            updateStore((prev) => ({ ...prev, tasks: [tsk, ...prev.tasks] }));
            setModalType(null);
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="حذف آیتم مالی شخصی"
        message={`آیا از حذف «${deleteTarget?.title || ''}» اطمینان دارید؟`}
        confirmLabel="حذف"
      />
    </div>
  );
}

function NewLoanForm({ onSave }: { onSave: (l: PersonalLoanItem) => void }) {
  const [title, setTitle] = useState('');
  const [bankName, setBankName] = useState('');
  const [totalLoanAmount, setTotalLoanAmount] = useState('');
  const [monthlyInstallment, setMonthlyInstallment] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('36');
  const [paidInstallments, setPaidInstallments] = useState('0');
  const [nextDueDate, setNextDueDate] = useState(todayGregorian());
  const [accountOrLoanNo, setAccountOrLoanNo] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      <Field label="عنوان وام (مثلاً وام مسکن، وام خرید یونیت، تسهیلات مطب)">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان وام..." />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="نام بانک / موسسه">
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="مثلاً بانک ملت" />
        </Field>
        <Field label="شماره وام / قرارداد">
          <Input value={accountOrLoanNo} onChange={(e) => setAccountOrLoanNo(e.target.value)} placeholder="اختیاری" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="مبلغ کل وام (تومان)">
          <Input type="number" value={totalLoanAmount} onChange={(e) => setTotalLoanAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="مبلغ هر قسط (تومان)">
          <Input type="number" value={monthlyInstallment} onChange={(e) => setMonthlyInstallment(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تعداد کل اقساط (ماه)">
          <Input type="number" value={totalInstallments} onChange={(e) => setTotalInstallments(e.target.value)} />
        </Field>
        <Field label="اقساط پرداخت‌شده تاکنون">
          <Input type="number" value={paidInstallments} onChange={(e) => setPaidInstallments(e.target.value)} />
        </Field>
      </div>
      <Field label="تاریخ سررسید قسط بعدی">
        <JalaliDatePicker value={nextDueDate} onChange={setNextDueDate} />
      </Field>
      <Field label="توضیحات">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="توضیحات..." />
      </Field>
      <Button
        color="#6366F1"
        disabled={!title.trim() || !monthlyInstallment}
        onClick={() =>
          onSave({
            id: `loan_${Date.now()}`,
            title: title.trim(),
            bankName: bankName.trim() || 'بانک',
            totalLoanAmount: Number(totalLoanAmount) || 0,
            monthlyInstallment: Number(monthlyInstallment) || 0,
            totalInstallments: Number(totalInstallments) || 12,
            paidInstallments: Number(paidInstallments) || 0,
            nextDueDate,
            accountOrLoanNo: accountOrLoanNo.trim(),
            status: 'active',
            notes: notes.trim(),
          })
        }
        className="w-full"
      >
        ذخیره وام و فعال‌سازی یادآوری اقساط
      </Button>
    </div>
  );
}

function NewRentForm({ onSave }: { onSave: (r: PersonalRentLeaseItem) => void }) {
  const [propertyTitle, setPropertyTitle] = useState('');
  const [role, setRole] = useState<'tenant' | 'landlord'>('tenant');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [monthlyRentAmount, setMonthlyRentAmount] = useState('');
  const [nextRentDueDate, setNextRentDueDate] = useState(todayGregorian());
  const [contractEndDate, setContractEndDate] = useState(todayGregorian());
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      <Field label="عنوان ملک (مثلاً مطب دندانپزشکی، منزل مسکونی، پارکینگ)">
        <Input value={propertyTitle} onChange={(e) => setPropertyTitle(e.target.value)} placeholder="عنوان ملک..." />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="نقش شما در قرارداد">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as 'tenant' | 'landlord')}
            options={[
              { value: 'tenant', label: 'مستاجر (پرداخت اجاره)' },
              { value: 'landlord', label: 'موجر / مالک (دریافت اجاره)' },
            ]}
          />
        </Field>
        <Field label="نام طرف قرارداد (مالک / مستاجر)">
          <Input value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} placeholder="نام و نام خانوادگی" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="مبلغ ودیعه / رهن کامل (تومان)">
          <Input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="مبلغ اجاره ماهانه (تومان)">
          <Input type="number" value={monthlyRentAmount} onChange={(e) => setMonthlyRentAmount(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="سررسید پرداخت اجاره بعدی">
          <JalaliDatePicker value={nextRentDueDate} onChange={setNextRentDueDate} />
        </Field>
        <Field label="تاریخ پایان قرارداد">
          <JalaliDatePicker value={contractEndDate} onChange={setContractEndDate} />
        </Field>
      </div>
      <Field label="توضیحات قرارداد">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="شماره شبا مالک، کد رهگیری..." />
      </Field>
      <Button
        color="#10B981"
        disabled={!propertyTitle.trim()}
        onClick={() =>
          onSave({
            id: `rent_${Date.now()}`,
            propertyTitle: propertyTitle.trim(),
            role,
            counterpartyName: counterpartyName.trim(),
            depositAmount: Number(depositAmount) || 0,
            monthlyRentAmount: Number(monthlyRentAmount) || 0,
            nextRentDueDate,
            contractEndDate,
            status: 'active',
            notes: notes.trim(),
          })
        }
        className="w-full"
      >
        ذخیره قرارداد رهن و اجاره
      </Button>
    </div>
  );
}

function NewPersonalCheckForm({ onSave }: { onSave: (c: PersonalCheckItem) => void }) {
  const [direction, setDirection] = useState<'issued' | 'received'>('issued');
  const [counterparty, setCounterparty] = useState('');
  const [bankName, setBankName] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [sayadId, setSayadId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(todayGregorian());
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="نوع چک شخصی">
          <Select
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'issued' | 'received')}
            options={[
              { value: 'issued', label: 'چک صادره شخصی (پرداختی)' },
              { value: 'received', label: 'چک دریافتی شخصی (ورودی)' },
            ]}
          />
        </Field>
        <Field label="در وجه / صادرکننده">
          <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="نام شخص یا شرکت" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="نام بانک">
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="مثلاً سامان، ملت..." />
        </Field>
        <Field label="مبلغ چک (تومان)">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="شماره سریال چک">
          <Input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} placeholder="سریال چک" />
        </Field>
        <Field label="شناسه ۱۶ رقمی صیاد">
          <Input
            maxLength={16}
            value={sayadId}
            onChange={(e) => setSayadId(e.target.value.replace(/\D/g, ''))}
            placeholder="۱۶ رقم صیاد"
          />
        </Field>
      </div>
      <Field label="تاریخ سررسید چک">
        <JalaliDatePicker value={dueDate} onChange={setDueDate} />
      </Field>
      <Field label="بابت / توضیحات">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="توضیحات..." />
      </Field>
      <Button
        color="#F59E0B"
        disabled={!counterparty.trim() || !amount}
        onClick={() =>
          onSave({
            id: `pchk_${Date.now()}`,
            direction,
            counterparty: counterparty.trim(),
            bankName: bankName.trim() || 'بانک',
            checkNumber: checkNumber.trim(),
            sayadId: sayadId.trim(),
            amount: Number(amount) || 0,
            dueDate,
            status: 'pending',
            notes: notes.trim(),
          })
        }
        className="w-full"
      >
        ثبت چک شخصی و یادآوری سررسید
      </Button>
    </div>
  );
}

function NewPurchaseForm({ onSave }: { onSave: (p: PersonalPurchaseItem) => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PersonalPurchaseItem['category']>('daily');
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayGregorian());
  const [status, setStatus] = useState<'planned' | 'purchased'>('planned');
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      <Field label="عنوان خرید / کالا">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً خرید لپ‌تاپ، لوازم منزل، تجهیزات..." />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="مبلغ (تومان)">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="فروشگاه / مرجع خرید">
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="نام فروشگاه" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="دسته‌بندی">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as PersonalPurchaseItem['category'])}
            options={[
              { value: 'daily', label: 'روزمره و شخصی' },
              { value: 'home', label: 'منزل و خانواده' },
              { value: 'equipment', label: 'تجهیزات و ابزار' },
              { value: 'vehicle', label: 'خودرو' },
              { value: 'investment', label: 'سرمایه‌گذاری' },
              { value: 'other', label: 'سایر' },
            ]}
          />
        </Field>
        <Field label="وضعیت">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'planned' | 'purchased')}
            options={[
              { value: 'planned', label: 'در لیست خرید آینده' },
              { value: 'purchased', label: 'خریداری و پرداخت شد' },
            ]}
          />
        </Field>
      </div>
      <Field label="تاریخ خرید / موعد">
        <JalaliDatePicker value={purchaseDate} onChange={setPurchaseDate} />
      </Field>
      <Field label="توضیحات">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="توضیحات..." />
      </Field>
      <Button
        color="#EC4899"
        disabled={!title.trim()}
        onClick={() =>
          onSave({
            id: `pur_${Date.now()}`,
            title: title.trim(),
            category,
            amount: Number(amount) || 0,
            vendor: vendor.trim(),
            purchaseDate,
            status,
            notes: notes.trim(),
          })
        }
        className="w-full"
      >
        ذخیره در لیست خریدها
      </Button>
    </div>
  );
}

function NewTaskForm({ onSave }: { onSave: (t: PersonalTaskItem) => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PersonalTaskItem['category']>('bank');
  const [dueDate, setDueDate] = useState(todayGregorian());
  const [priority, setPriority] = useState<PersonalTaskItem['priority']>('high');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="space-y-4">
      <Field label="عنوان کار یا برنامه شخصی">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً مراجعه به بانک، تمدید مجوز..." />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="دسته‌بندی">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as PersonalTaskItem['category'])}
            options={[
              { value: 'bank', label: 'امور بانکی و مالی' },
              { value: 'clinic_admin', label: 'امور اداری و مدیریتی مطب' },
              { value: 'family', label: 'خانواده و شخصی' },
              { value: 'investment', label: 'سرمایه‌گذاری و قراردادها' },
              { value: 'other', label: 'سایر' },
            ]}
          />
        </Field>
        <Field label="اولویت">
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value as PersonalTaskItem['priority'])}
            options={[
              { value: 'urgent', label: 'فوری' },
              { value: 'high', label: 'مهم' },
              { value: 'medium', label: 'متوسط' },
              { value: 'low', label: 'عادی' },
            ]}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاریخ انجام / سررسید">
          <JalaliDatePicker value={dueDate} onChange={setDueDate} />
        </Field>
        <Field label="هزینه احتمالی (اختیاری - تومان)">
          <Input type="number" value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <Field label="یادداشت">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="توضیحات تکمیلی..." />
      </Field>
      <Button
        color="#8B5CF6"
        disabled={!title.trim()}
        onClick={() =>
          onSave({
            id: `tsk_${Date.now()}`,
            title: title.trim(),
            category,
            dueDate,
            priority,
            estimatedCost: Number(estimatedCost) || 0,
            done: false,
            notes: notes.trim(),
          })
        }
        className="w-full"
      >
        ثبت کار شخصی
      </Button>
    </div>
  );
}
