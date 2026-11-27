import { useState, useMemo, useEffect } from 'react';
import {
  Users, Search, Plus, Phone, FileText, Wallet, CreditCard,
  ScrollText, Trash2, FileSpreadsheet, AlertTriangle,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase,
  type Patient, type Appointment, type Treatment, type Payment,
  type LabOrder, type Implant, type Reminder,
  type Installment, type Check as CheckType, type Safteh,
} from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Input, EmptyState } from '@/components/ui/Form';
import { PatientGalleryModal } from '@/components/ui/PatientGalleryModal';
import { PrintInvoiceModal } from '@/components/ui/PrintInvoiceModal';
import { ConsentModal } from '@/components/ui/ConsentModal';
import { exportToCsv } from '@/lib/exportUtils';
import { subscribeGlobalFocus, emitGlobalFocus } from '@/lib/globalFocus';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { HapticEngine } from '@/lib/hapticsAudio';
import { ContextMenuTrigger } from '@/components/ui/ContextMenu';
import { getRuntimeAuthStatus, getRuntimeServerVerifiedRole } from '@/services/authentication/authService';
import { useClinicShell } from '@/app/AppProviders';
import { computePatientFinancialLedger } from '@/features/finance/financialLedgerEngine';
import { resolveEffectiveRole, canAccessRoute } from '@/services/permissions/accessControl';
import { loadActiveUser } from '@/lib/cloudSyncEngine';
import { computePatientClinicalJourney, type ClinicalJourneyStageId } from '@/features/clinical-journey/patientJourney';
import { ClinicalJourneyStepper } from '@/features/clinical-journey/ClinicalJourneyStepper';
import {
  assessPatientAllergySafety,
  archiveOrDeletePatientCommand,
} from '@/features/clinical-record/clinicalRecordService';
import { PatientForm } from '@/features/patients/PatientClinicalTabs';
import { LAB_STATUS, IMPLANT_STAGES } from '@/features/patients/PatientFinanceAndSpecialtyTabs';
import { PatientDetail } from '@/features/patients/PatientDetailHub';
import { getRecordedPatientFileNo, matchesPatientDirectoryQuery, findVisiblePatientIdentityConflict, normalizePatientQuery } from '@/features/patients/patientDirectorySearch';

export function Patients() {
  const { effectiveRole } = useClinicShell();
  const canViewFinance = canAccessRoute(effectiveRole, 'finance');
  const patientsRead = useRealtimeTable<Patient>('patients');
  const { data: patients, refresh } = patientsRead;
  const { data: appointments } = useRealtimeTable<Appointment>('appointments');
  const treatmentsRead = useRealtimeTable<Treatment>('treatments');
  const { data: treatments } = treatmentsRead;
  const paymentsRead = useRealtimeTable<Payment>('payments');
  const { data: payments } = paymentsRead;
  const { data: labOrders } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: implants } = useRealtimeTable<Implant>('implants');
  const { data: reminders } = useRealtimeTable<Reminder>('reminders');
  const installmentsRead = useRealtimeTable<Installment>('installments');
  const { data: installments } = installmentsRead;
  const checksRead = useRealtimeTable<CheckType>('checks');
  const { data: checks } = checksRead;
  const saftehRead = useRealtimeTable<Safteh>('safteh');
  const { data: safteh } = saftehRead;

  const financialReady = canViewFinance && [patientsRead, treatmentsRead, paymentsRead, installmentsRead, checksRead, saftehRead].every(read =>
    (read.status === 'ready' || read.status === 'empty') && !read.loading && !read.isStale && !read.truncated
  );
  const ledgers = useMemo(() => financialReady ? new Map(patients.map(patient => [
    patient.id, computePatientFinancialLedger({ patient, treatments, payments, installments, checks, safteh }),
  ] as const)) : new Map<string, ReturnType<typeof computePatientFinancialLedger>>(),
  [financialReady, patients, treatments, payments, installments, checks, safteh]);

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [chipFilter, setChipFilter] = useState<'all' | 'active_treat' | 'lab' | 'implant' | 'checks_inst' | 'debtors'>('all');
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailPatient, setDetailPatient] = useState<Patient | null>(null);
  const [detailStage, setDetailStage] = useState<ClinicalJourneyStageId | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);


  useEffect(() => {
    return subscribeGlobalFocus('patients', (payload) => {
      setChipFilter('all');
      if (payload.query) { setSearch(payload.query); setSearchOpen(true); }
      if (payload.recordId) setExpandedCardId(payload.recordId);
    });
  }, []);

  const filtered = useMemo(() => {
    let list = patients;
    if (chipFilter === 'active_treat') {
      list = list.filter((p) => treatments.some((t) => t.patient_id === p.id && (t.status === 'in_progress' || t.status === 'planned')));
    } else if (chipFilter === 'lab') {
      list = list.filter((p) => labOrders.some((l) => l.patient_id === p.id));
    } else if (chipFilter === 'implant') {
      list = list.filter((p) => implants.some((im) => im.patient_id === p.id));
    } else if (chipFilter === 'checks_inst' && financialReady) {
      list = list.filter((p) => installments.some((i) => i.patient_id === p.id && i.status === 'active') || checks.some((c) => c.patient_id === p.id && c.status === 'pending'));
    } else if (chipFilter === 'debtors' && financialReady) {
      list = list.filter(p => (ledgers.get(p.id)?.totalRemainingDebt ?? 0) > 0);
    }
    return list.filter(patient => matchesPatientDirectoryQuery(patient, search));
  }, [patients, treatments, labOrders, implants, installments, checks, search, chipFilter, financialReady, ledgers]);

  const handleSave = async (data: Partial<Patient>): Promise<boolean> => {
    if (saving) return false;
    const reference = getRecordedPatientFileNo({ first_name: '', last_name: '', phone: null, national_id: null, insurance_number: null, notes: data.notes ?? null });
    const existingReference = editing ? getRecordedPatientFileNo(editing) : null;
    const conflict = findVisiblePatientIdentityConflict(patients, {
      fileNo: normalizePatientQuery(reference ?? '') !== normalizePatientQuery(existingReference ?? '') ? reference : null,
      nationalId: normalizePatientQuery(data.national_id ?? '') !== normalizePatientQuery(editing?.national_id ?? '') ? data.national_id : null,
    }, editing?.id);
    if (conflict) {
      setActionError(conflict === 'file' ? 'شماره پرونده در فهرست فعلی تکراری است.' : 'کد ملی در فهرست فعلی تکراری است.');
      HapticEngine.warning();
      return false;
    }
    setSaving(true);
    setActionSuccess(null);
    const result = editing
      ? await supabase.from('patients').update(data).eq('id', editing.id)
      : await supabase.from('patients').insert(data);
    setSaving(false);
    const outcome = getMutationOutcome(result);
    if (outcome === 'error') {
      HapticEngine.error();
      setActionError('ذخیره پرونده انجام نشد. لطفاً دوباره تلاش کنید.');
      return false;
    }
    if (outcome === 'confirmed') {
      HapticEngine.success();
      setActionError(null);
    } else {
      HapticEngine.warning();
      setActionError('در حالت آفلاین ذخیره شد و پس از اتصال در سرور تایید می‌شود.');
    }
    setFormOpen(false);
    setEditing(null);
    refresh();
    return true;
  };

  const handleDeleteOrArchive = async () => {
    if (!deleteId) return;
    const actorRole = resolveEffectiveRole({
      sessionStatus: getRuntimeAuthStatus(),
      serverVerifiedRole: getRuntimeServerVerifiedRole(),
      localRole: loadActiveUser().role,
    });
    const res = await archiveOrDeletePatientCommand({
      actorRole,
      patientId: deleteId,
      treatments: treatments.filter((t) => t.patient_id === deleteId),
      appointments: appointments.filter((a) => a.patient_id === deleteId),
      payments: payments.filter((p) => p.patient_id === deleteId),
    });
    setDeleteId(null);
    if (!res.ok) {
      HapticEngine.error();
      setActionError(res.messageFa);
      return;
    }
    HapticEngine.success();
    setActionError(null);
    setActionSuccess(res.messageFa);
    refresh();
  };

  const handleExportCsv = () => {
    if (!financialReady) return;
    const rows = patients.map((p) => {
      const ledger = ledgers.get(p.id)!;
      return {
        file_no: getRecordedPatientFileNo(p) ?? '',
        first_name: p.first_name,
        last_name: p.last_name,
        national_id: p.national_id || '',
        phone: p.phone || '',
        gender: p.gender === 'female' ? 'زن' : p.gender === 'male' ? 'مرد' : 'نامشخص',
        insurance: p.insurance_provider || 'آزاد',
        total_cost: ledger.postedChargesTotal,
        total_paid: ledger.netPaidTotal,
        balance: ledger.totalRemainingDebt,
        status: p.status === 'active' ? 'فعال' : 'آرشیوشده',
      };
    });
    exportToCsv(`MinaDental_Patients_${new Date().toISOString().slice(0, 10)}`, rows, [
      { key: 'file_no', label: 'شماره پرونده' },
      { key: 'first_name', label: 'نام' },
      { key: 'last_name', label: 'نام خانوادگی' },
      { key: 'national_id', label: 'کد ملی' },
      { key: 'phone', label: 'شماره تماس' },
      { key: 'gender', label: 'جنسیت' },
      { key: 'insurance', label: 'بیمه' },
      { key: 'total_cost', label: 'هزینه کل (تومان)' },
      { key: 'total_paid', label: 'پرداخت شده (تومان)' },
      { key: 'balance', label: 'مانده حساب (تومان)' },
      { key: 'status', label: 'وضعیت پرونده' },
    ]);
  };

  return (
    <div className="space-y-2.5 pb-32 animate-fade-in-up">
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`min-w-[44px] min-h-[44px] rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${searchOpen || search ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
            title="جستجوی سریع بیمار، موبایل یا شماره پرونده"
            aria-label="جستجوی بیمار"
            aria-expanded={searchOpen}
          >
            <Search size={17} />
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {[
              { id: 'all' as const, label: 'همه پرونده‌ها', count: patients.length, color: '#059669' },
              { id: 'active_treat' as const, label: 'درمان فعال', count: patients.filter((p) => treatments.some((t) => t.patient_id === p.id && t.status !== 'completed')).length, color: '#7C3AED' },
              { id: 'lab' as const, label: 'دارای لابراتوار', count: patients.filter((p) => labOrders.some((l) => l.patient_id === p.id)).length, color: '#DB2777' },
              { id: 'implant' as const, label: 'دارای ایمپلنت', count: patients.filter((p) => implants.some((im) => im.patient_id === p.id)).length, color: '#0891B2' },
              { id: 'checks_inst' as const, label: 'چک و اقساط', count: patients.filter((p) => installments.some((i) => i.patient_id === p.id && i.status === 'active') || checks.some((c) => c.patient_id === p.id && c.status === 'pending')).length, color: '#D97706' },
              { id: 'debtors' as const, label: 'بدهکاران', count: patients.filter(p => (ledgers.get(p.id)?.totalRemainingDebt ?? 0) > 0).length, color: '#E11D48' },
            ].filter(ch => financialReady || !['debtors', 'checks_inst'].includes(ch.id)).map((ch) => {
              const active = chipFilter === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => setChipFilter(ch.id)}
                  className={`px-3 py-1.5 rounded-2xl text-[11px] font-extrabold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 haptic ${active ? 'text-white shadow-md scale-[1.02]' : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/70'}`}
                  style={active ? { background: ch.color } : undefined}
                >
                  <span>{ch.label}</span>
                  <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full ${active ? 'bg-white/25 text-white' : 'bg-white text-gray-500'}`}>
                    {ch.count.toLocaleString('fa-IR')}
                  </span>
                </button>
              );
            })}
            <button disabled={!financialReady} onClick={handleExportCsv} className="px-2.5 py-1.5 rounded-2xl bg-sky-50 text-sky-700 border border-sky-200 text-[11px] font-extrabold whitespace-nowrap flex items-center gap-1 shrink-0 haptic" title="خروجی اکسل پرونده‌ها">
              <FileSpreadsheet size={13} /><span>اکسل</span>
            </button>
          </div>

          <button
            onClick={() => { setEditing(null); setFormOpen(true); }}
            className="w-9 h-9 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            aria-label="پرونده بیمار جدید"
          >
            <Plus size={20} />
          </button>
        </div>

        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" />
              <Input autoFocus aria-label="جستجو با نام، شماره پرونده، موبایل یا کد ملی" type="search" placeholder="جستجو با نام، شماره پرونده، موبایل یا کد ملی..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 text-xs" />
            </div>
          </div>
        )}
      </div>

      {actionError && <p className="text-xs text-red-600 bg-red-50 rounded-xl p-2.5 border border-red-200">{actionError}</p>}
      {actionSuccess && <p className="text-xs text-emerald-700 bg-emerald-50 rounded-xl p-2.5 border border-emerald-200">{actionSuccess}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<Users size={28} />} title="پرونده‌ای یافت نشد" subtitle={search.trim() || chipFilter !== 'all' ? 'عبارت جستجو یا فیلتر را تغییر دهید.' : 'برای تشکیل پرونده جدید روی دکمه + بزنید'} color="#10B981" />
      ) : (
        <div className="space-y-2.5 stagger">
          {filtered.map((patient) => {
            const pAppointments = appointments.filter((a) => a.patient_id === patient.id);
            const pTreatments = treatments.filter((t) => t.patient_id === patient.id);
            const pPayments = payments.filter((p) => p.patient_id === patient.id);
            const pLabs = labOrders.filter((l) => l.patient_id === patient.id);
            const pImplants = implants.filter((im) => im.patient_id === patient.id);
            const pReminders = reminders.filter((r) => r.patient_id === patient.id);
            const ledger = ledgers.get(patient.id);
            const totalPaid = ledger?.netPaidTotal ?? 0;
            const totalCost = ledger?.postedChargesTotal ?? 0;
            const balance = ledger?.totalRemainingDebt ?? 0;
            const pInstallments = installments.filter((i) => i.patient_id === patient.id && i.status === 'active');
            const pChecks = checks.filter((c) => c.patient_id === patient.id && c.status === 'pending');
            const allergySafety = assessPatientAllergySafety(patient);
            const fileNo = getRecordedPatientFileNo(patient);
            const isExpanded = expandedCardId === patient.id;

            const clinicalJourney = computePatientClinicalJourney({
              patient,
              appointments: pAppointments,
              treatments: pTreatments,
              payments: pPayments,
              installments: pInstallments,
              checks: pChecks,
              reminders: pReminders,
            });

            return (
              <ContextMenuTrigger
                key={patient.id}
                title={`${patient.first_name} ${patient.last_name}`}
                testId={`patient_context_${patient.id}`}
                items={[
                  { id: 'open_detail', label: 'مشاهده پرونده کامل', icon: <FileText size={15} />, onSelect: () => { setDetailStage(null); setDetailPatient(patient); } },
                  { id: 'edit_patient', label: 'ویرایش مشخصات بیمار', icon: <Users size={15} />, onSelect: () => { setEditing(patient); setFormOpen(true); } },
                  ...(canViewFinance ? [{ id: 'patient_finance', label: 'حساب مالی و اقساط', icon: <Wallet size={15} />, onSelect: () => emitGlobalFocus({ section: 'finance', query: `${patient.first_name} ${patient.last_name}` }) }] : []),
                  { id: 'delete_patient', label: 'آرشیو / حذف حفاظت‌شده پرونده', destructive: true, icon: <Trash2 size={15} />, onSelect: () => setDeleteId(patient.id) },
                ]}
              >
                <div className="glass-card p-3.5 transition-all">
                  <div className="flex flex-col sm:flex-row items-start justify-between gap-2.5">
                    <div role="button" tabIndex={0} aria-label={`باز کردن پرونده ${patient.first_name} ${patient.last_name}`} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailStage(null); setDetailPatient(patient); } }} onClick={() => { setDetailStage(null); setDetailPatient(patient); }} className="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer rounded-xl focus-visible:ring-2 focus-visible:ring-teal-600">
                      <div
                        className="w-11 h-11 rounded-2xl flex flex-col items-center justify-center text-white font-black text-sm shrink-0 shadow-sm"
                        style={{ background: patient.gender === 'female' ? 'linear-gradient(135deg,#EC4899,#DB2777)' : 'linear-gradient(135deg,#10B981,#059669)' }}
                      >
                        <span>{patient.first_name[0]}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-1.5">
                          <h3 className="text-sm font-black text-slate-800 truncate">{patient.first_name} {patient.last_name}</h3>
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">{fileNo ? `پرونده #${fileNo}` : 'شماره پرونده ثبت نشده'}</span>
                          {patient.status === 'inactive' && <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-lg bg-slate-200 text-slate-700">آرشیوشده</span>}
                          {allergySafety.assistiveFreeTextAlerts.length > 0 && (
                            <span className="flex items-center gap-0.5 text-[9.5px] font-extrabold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-lg shrink-0">
                              <AlertTriangle size={10} /> {allergySafety.assistiveFreeTextAlerts[0].titleFa.split('(')[0]}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center flex-wrap gap-2.5 mt-1 text-[11px] text-gray-500">
                          {patient.phone && <span className="flex items-center gap-1 font-semibold" dir="ltr"><Phone size={11} className="text-emerald-600" />{patient.phone}</span>}
                          {financialReady && pInstallments.length > 0 && <span className="flex items-center gap-0.5 text-blue-600 font-bold"><CreditCard size={11} /> {pInstallments.length.toLocaleString('fa-IR')} قسط</span>}
                          {financialReady && pChecks.length > 0 && <span className="flex items-center gap-0.5 text-amber-600 font-bold"><ScrollText size={11} /> {pChecks.length.toLocaleString('fa-IR')} چک</span>}
                        </div>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto text-left flex flex-wrap sm:flex-col items-end gap-1 min-w-0">
                      {!canViewFinance ? null : !ledger ? <span className="text-xs text-[var(--md-secondary)]">مانده حساب نامشخص</span> : balance > 0 ? (
                        <span className="px-2.5 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-[11px] font-black">مانده: {balance.toLocaleString('fa-IR')} ت</span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-black">مانده ثبت‌شده: صفر</span>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <button aria-expanded={isExpanded} onClick={() => setExpandedCardId(isExpanded ? null : patient.id)} className="min-h-[44px] text-xs font-extrabold text-purple-600 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded-lg">
                          {isExpanded ? 'بستن ریز پرونده ▲' : 'ریز روند و دندان ▼'}
                        </button>
                        <button onClick={() => { setDetailStage(null); setDetailPatient(patient); }} className="min-h-[44px] text-xs font-extrabold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg">
                          پرونده کامل ←
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-gray-100 space-y-2" data-testid={`patient_clinical_journey_${patient.id}`}>
                    <div className="flex items-center justify-between gap-2 text-[10px] flex-wrap">
                      <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                        <span className="font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg break-words">
                          مسیر بالینی: {clinicalJourney.currentStageLabelFa} ({clinicalJourney.progressPercent.toLocaleString('fa-IR')}٪)
                        </span>
                        {clinicalJourney.longitudinalHistory.historicalCompletedTreatmentsCount > 0 && (
                          <span className="text-[9.5px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">
                            سابقه: {clinicalJourney.longitudinalHistory.historicalCompletedTreatmentsCount.toLocaleString('fa-IR')} درمان تکمیل‌شده
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-sky-800 dark:text-sky-300 break-words">
                        گام بعدی: {clinicalJourney.nextActionLabelFa}
                      </span>
                    </div>
                    <ClinicalJourneyStepper journey={clinicalJourney} onContinue={(stage) => {
                      if (['appointment', 'check_in', 'waiting'].includes(stage.id)) {
                        emitGlobalFocus({ section: 'appointments', query: `${patient.first_name} ${patient.last_name}`, recordId: patient.id });
                      } else {
                        setDetailStage(stage.id);
                        setDetailPatient(patient);
                      }
                    }} />
                  </div>

                  {isExpanded && (
                    <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200 space-y-2 animate-fade-in">
                      {ledger && <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="rounded-xl bg-slate-50 p-1.5"><p className="text-[9px] text-gray-400">جمع کل درمان</p><p className="text-xs font-black text-slate-700">{totalCost.toLocaleString('fa-IR')} ت</p></div>
                        <div className="rounded-xl bg-emerald-50/70 p-1.5"><p className="text-[9px] text-emerald-600">پرداختی بیمار</p><p className="text-xs font-black text-emerald-700">{totalPaid.toLocaleString('fa-IR')} ت</p></div>
                        <div className="rounded-xl bg-rose-50/70 p-1.5"><p className="text-[9px] text-rose-500">مانده بدهی</p><p className="text-xs font-black text-rose-600">{balance.toLocaleString('fa-IR')} ت</p></div>
                      </div>}
                      {pTreatments.length > 0 && (
                        <div className="space-y-1">
                          {pTreatments.slice(0, 3).map((t) => (
                            <div key={t.id} className="flex items-center justify-between bg-violet-50/60 rounded-xl px-2.5 py-1.5 text-[10.5px]">
                              <div className="min-w-0 flex-1">
                                <span className="font-extrabold text-slate-800">{t.diagnosis || 'درمان دندانپزشکی'}</span>
                                {t.tooth_numbers && <span className="text-violet-700 font-bold mr-1.5">• دندان {t.tooth_numbers}</span>}
                              </div>
                              <span className="font-black text-violet-700 shrink-0">{Number(t.total_cost).toLocaleString('fa-IR')} ت</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {(pLabs.length > 0 || pImplants.length > 0) && (
                        <div className="flex flex-wrap gap-1.5">
                          {pLabs.map((l) => <span key={l.id} className="text-[10px] font-bold bg-pink-50 text-pink-700 border border-pink-200 px-2 py-0.5 rounded-lg">لابراتوار: {LAB_STATUS[l.status]?.label || l.status}</span>)}
                          {pImplants.map((im) => <span key={im.id} className="text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded-lg">ایمپلنت {im.tooth_number || '-'}: {IMPLANT_STAGES.find((s) => s.value === im.stage)?.label || im.stage}</span>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ContextMenuTrigger>
            );
          })}
        </div>
      )}

      <Sheet open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} title={editing ? 'ویرایش پرونده بیمار' : 'تشکیل پرونده بیمار جدید'} icon={<Users size={20} />} color="#10B981">
        <PatientForm patient={editing} onSave={handleSave} saving={saving} />
      </Sheet>

      <Sheet layout="workspace" open={!!detailPatient} onClose={() => setDetailPatient(null)} title={detailPatient ? `${detailPatient.first_name} ${detailPatient.last_name}` : ''} icon={<Users size={20} />} color="#10B981">
        {detailPatient && (
          <PatientDetail
            key={detailPatient.id}
            patient={detailPatient}
            initialStage={detailStage}
            canViewFinance={canViewFinance}
            financialReady={financialReady}
            onOpenAppointments={() => {
              emitGlobalFocus({ section: 'appointments', query: `${detailPatient.first_name} ${detailPatient.last_name}`, recordId: detailPatient.id });
              setDetailPatient(null);
            }}
            appointments={appointments.filter((a) => a.patient_id === detailPatient.id)}
            treatments={treatments.filter((t) => t.patient_id === detailPatient.id)}
            payments={payments.filter((p) => p.patient_id === detailPatient.id)}
            labOrders={labOrders.filter((l) => l.patient_id === detailPatient.id)}
            implants={implants.filter((i) => i.patient_id === detailPatient.id)}
            reminders={reminders.filter((r) => r.patient_id === detailPatient.id)}
            installments={installments.filter((i) => i.patient_id === detailPatient.id)}
            checks={checks.filter((c) => c.patient_id === detailPatient.id)}
            safteh={safteh.filter((s) => s.patient_id === detailPatient.id)}
            onEdit={() => { setEditing(detailPatient); setDetailPatient(null); setFormOpen(true); }}
            onDelete={() => { setDeleteId(detailPatient.id); setDetailPatient(null); }}
            onOpenGallery={() => setGalleryOpen(true)}
            onOpenPrint={() => setPrintOpen(true)}
            onOpenConsent={() => setConsentOpen(true)}
          />
        )}
      </Sheet>

      <PatientGalleryModal open={galleryOpen} onClose={() => setGalleryOpen(false)} patient={detailPatient} />
      <PrintInvoiceModal open={printOpen && canViewFinance} onClose={() => setPrintOpen(false)} patient={detailPatient} treatments={treatments.filter((t) => t.patient_id === detailPatient?.id)} />
      <ConsentModal open={consentOpen} onClose={() => setConsentOpen(false)} patient={detailPatient} />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDeleteOrArchive}
        title="آرشیو / حذف حفاظت‌شده پرونده"
        message="طبق استاندارد حفاظت پرونده بالینی (V15 CL-05)، در صورت وجود سابقه درمان یا مالی، پرونده حذف فیزیکی نمی‌شود بلکه به‌صورت امن آرشیو می‌گردد."
        confirmLabel="تأیید آرشیو / حذف"
      />
    </div>
  );
}