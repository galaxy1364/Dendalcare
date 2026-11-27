import { useEffect, useState } from 'react';
import {
  Briefcase,
  CreditCard,
  FileCheck,
  ScrollText,
  Search,
  ShieldAlert,
  UserCog,
  Wallet,
  X,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import type {
  Check,
  FinanceTransaction,
  Installment,
  Patient,
  Payment,
  Reminder,
  Safteh,
  Staff,
  Treatment,
} from '@/lib/supabase';
import { Input } from '@/components/ui/Form';
import { PersonalFinance } from '@/components/sections/PersonalFinance';
import { subscribeGlobalFocus } from '@/lib/globalFocus';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { HapticEngine } from '@/lib/hapticsAudio';
import { FinanceDebtorsTab } from '@/features/finance/FinanceDebtorsTab';
import { FinanceDoctorShareTab } from '@/features/finance/FinanceDoctorShareTab';
import {
  FinanceChecksTab,
  FinanceInstallmentsTab,
  FinanceSaftehTab,
} from '@/features/finance/FinanceInstrumentsTabs';
import { FinanceTransactionsAndCloseTab } from '@/features/finance/FinanceTransactionsAndCloseTab';

type FinanceTab =
  | 'debtors'
  | 'doctor'
  | 'personal'
  | 'installments'
  | 'checks'
  | 'safteh'
  | 'transactions';

export function Finance() {
  const transactionsRead = useRealtimeTable<FinanceTransaction>('finance_transactions', undefined, null, { fetchAllPages: true });
  const { data: transactions, refresh: rt } = transactionsRead;
  const patientsRead = useRealtimeTable<Patient>('patients', undefined, null, { fetchAllPages: true });
  const { data: patients } = patientsRead;
  const installmentsRead = useRealtimeTable<Installment>('installments', undefined, null, { fetchAllPages: true });
  const { data: installments, refresh: ri } = installmentsRead;
  const checksRead = useRealtimeTable<Check>('checks', undefined, null, { fetchAllPages: true });
  const { data: checks, refresh: rc } = checksRead;
  const saftehRead = useRealtimeTable<Safteh>('safteh', undefined, null, { fetchAllPages: true });
  const { data: safteh, refresh: rs } = saftehRead;
  const treatmentsRead = useRealtimeTable<Treatment>('treatments', undefined, null, { fetchAllPages: true });
  const { data: treatments } = treatmentsRead;
  const paymentsRead = useRealtimeTable<Payment>('payments', undefined, null, { fetchAllPages: true });
  const { data: payments, refresh: rpay } = paymentsRead;
  const { data: staff } = useRealtimeTable<Staff>('staff');
  const remindersRead = useRealtimeTable<Reminder>('reminders', undefined, null, { fetchAllPages: true });
  const { data: reminders, refresh: rrem } = remindersRead;

  const completeRead = (read: { status: string; loading: boolean; isStale: boolean; truncated: boolean; serverComplete: boolean }) =>
    (read.status === 'ready' || read.status === 'empty') && !read.loading && !read.isStale && !read.truncated && read.serverComplete;
  const receivablesReady = [patientsRead, treatmentsRead, paymentsRead, installmentsRead, checksRead, saftehRead, transactionsRead].every(completeRead);
  const remindersReady = receivablesReady && completeRead(remindersRead);

  const [tab, setTab] = useState<FinanceTab>('debtors');
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');

  useEffect(() => {
    return subscribeGlobalFocus('finance', (payload) => {
      if (payload.subTab) setTab(payload.subTab as FinanceTab);
      if (payload.query) {
        setGlobalSearch(payload.query);
        setSearchOpen(true);
      }
    });
  }, []);

  const chips: { v: FinanceTab; l: string; i: React.ReactNode; badge?: number }[] = [
    { v: 'debtors', l: 'بدهکاران و مطالبات مطب', i: <ShieldAlert size={13} /> },
    { v: 'doctor', l: 'سهم کارکرد پزشکان', i: <UserCog size={13} /> },
    { v: 'personal', l: 'مالی شخصی', i: <Briefcase size={13} /> },
    {
      v: 'installments',
      l: 'اقساط',
      i: <CreditCard size={13} />,
      badge: installments.filter((i) => i.status === 'active').length,
    },
    {
      v: 'checks',
      l: 'چک‌های صیادی',
      i: <FileCheck size={13} />,
      badge: checks.filter((c) => c.status === 'pending').length,
    },
    {
      v: 'safteh',
      l: 'سفته و ضمانت',
      i: <ScrollText size={13} />,
      badge: safteh.filter((s) => s.status === 'pending').length,
    },
    { v: 'transactions', l: 'خزانه و تراکنش‌ها', i: <Wallet size={13} /> },
  ];

  const refreshAll = (serverRes?: { error?: unknown; data?: unknown }) => {
    if (serverRes && getMutationOutcome(serverRes) === 'error') {
      HapticEngine.error();
      return;
    }
    patientsRead.refresh();
    treatmentsRead.refresh();
    rpay();
    ri();
    rc();
    rs();
    rt();
    rrem();
  };

  const selectTab = (next: FinanceTab) => {
    HapticEngine.selection();
    setTab(next);
  };

  return (
    <div className="space-y-2.5 pb-36 animate-fade-in-up">
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              HapticEngine.selection();
              setSearchOpen(!searchOpen);
              if (searchOpen) setGlobalSearch('');
            }}
            data-testid="finance_search_toggle"
            className={`min-w-[48px] min-h-[48px] rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
            aria-label="جستجوی سریع در امور مالی"
            aria-expanded={searchOpen}
            title="جستجوی سریع در امور مالی"
          >
            {searchOpen ? <X size={16} /> : <Search size={16} />}
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 no-scrollbar">
            {chips.map((c) => {
              const active = tab === c.v;
              return (
                <button
                  key={c.v}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => selectTab(c.v)}
                  data-testid={`finance_tab_${c.v}`}
                  className={`min-h-[48px] flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all haptic ${
                    active
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/25 scale-[1.02]'
                      : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/70'
                  }`}
                >
                  {c.i}
                  <span>{c.l}</span>
                  {c.badge !== undefined && c.badge > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                        active ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {c.badge.toLocaleString('fa-IR')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" />
              <Input
                autoFocus
                aria-label="جستجو در امور مالی"
                type="search"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="جستجوی نام بیمار، شماره دندان، شماره چک صیادی، کد درمان..."
                className="pr-9 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {tab === 'debtors' && (
        <FinanceDebtorsTab
          patients={patients}
          treatments={treatments}
          payments={payments}
          installments={installments}
          checks={checks}
          safteh={safteh}
          reminders={reminders}
          transactions={transactions}
          receivablesReady={receivablesReady}
          remindersReady={remindersReady}
          searchQuery={globalSearch}
          onRefreshAll={refreshAll}
        />
      )}
      {tab === 'doctor' && (
        <FinanceDoctorShareTab
          treatments={treatments}
          patients={patients}
          staff={staff}
          transactions={transactions}
          searchQuery={globalSearch}
          onRefreshTransactions={rt}
        />
      )}
      {tab === 'personal' && <PersonalFinance />}
      {tab === 'installments' && (
        <FinanceInstallmentsTab installments={installments} patients={patients} refresh={ri} />
      )}
      {tab === 'checks' && (
        <FinanceChecksTab checks={checks} patients={patients} refresh={rc} />
      )}
      {tab === 'safteh' && (
        <FinanceSaftehTab safteh={safteh} patients={patients} refresh={rs} />
      )}
      {tab === 'transactions' && (
        <FinanceTransactionsAndCloseTab
          transactions={transactions}
          payments={payments}
          treatments={treatments}
          patients={patients}
          refresh={refreshAll}
        />
      )}
    </div>
  );
}
