import { useState } from 'react';
import {
  Heart, FileText, Activity, Stethoscope, Wallet, FlaskConical,
  Anchor, BellRing, CreditCard, ScrollText, Camera, Printer,
  AlertTriangle, FileSignature,
} from 'lucide-react';
import type {
  Patient, Appointment, Treatment, Payment, LabOrder,
  Implant, Reminder, Installment, Check as CheckType, Safteh,
} from '@/lib/supabase';
import { Button } from '@/components/ui/Form';
import { PalmerChart } from '@/components/PalmerChart';
import { computePatientClinicalJourney, type ClinicalJourneyStageId } from '@/features/clinical-journey/patientJourney';
import { ClinicalJourneyStepper } from '@/features/clinical-journey/ClinicalJourneyStepper';
import { assessPatientAllergySafety } from '@/features/clinical-record/clinicalRecordService';
import { computePatientFinancialLedger } from '@/features/finance/financialLedgerEngine';
import { InfoTab, TreatmentsTab } from './PatientClinicalTabs';
import {
  PaymentsTab, InstallmentsTab, ChecksTab, SaftehTab,
  LabTab, ImplantsTab, RemindersTab,
} from './PatientFinanceAndSpecialtyTabs';

export type PatientTab =
  | 'info'
  | 'chart'
  | 'treatments'
  | 'payments'
  | 'installments'
  | 'checks'
  | 'safteh'
  | 'lab'
  | 'implants'
  | 'reminders';

const stageTabs: Partial<Record<ClinicalJourneyStageId, PatientTab>> = {
  reception: 'info', examination: 'chart', treatment_planning: 'treatments',
  treatment_execution: 'treatments', billing: 'payments', follow_up: 'reminders',
};

export function PatientDetail({
  patient, appointments, treatments, payments, labOrders, implants, reminders, installments, checks, safteh,
  onEdit, onDelete, onOpenGallery, onOpenPrint, onOpenConsent, initialStage, onOpenAppointments, canViewFinance, financialReady,
}: {
  patient: Patient;
  canViewFinance: boolean;
  financialReady: boolean;
  appointments: Appointment[];
  treatments: Treatment[];
  payments: Payment[];
  labOrders: LabOrder[];
  implants: Implant[];
  reminders: Reminder[];
  installments: Installment[];
  checks: CheckType[];
  safteh: Safteh[];
  initialStage?: ClinicalJourneyStageId | null;
  onOpenAppointments?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenGallery: () => void;
  onOpenPrint: () => void;
  onOpenConsent: () => void;
}) {
  const [requestedTab, setTab] = useState<PatientTab>(() => initialStage ? stageTabs[initialStage] ?? 'info' : 'info');
  const financialTabs: PatientTab[] = ['payments', 'installments', 'checks', 'safteh'];
  const tab = !canViewFinance && financialTabs.includes(requestedTab) ? 'info' : requestedTab;
  const ledger = computePatientFinancialLedger({
    patient,
    treatments,
    payments,
    installments,
    checks,
    safteh,
  });
  const totalCost = ledger.postedChargesTotal;
  const totalPaid = ledger.netPaidTotal;
  const balance = ledger.totalRemainingDebt;
  const clinicalJourney = computePatientClinicalJourney({
    patient, appointments, treatments, payments, installments, checks, reminders,
  });
  const allergySafety = assessPatientAllergySafety(patient);

  const tabs: { id: PatientTab; label: string; icon: typeof Heart; color: string; count?: number }[] = [
    { id: 'info', label: 'اطلاعات', icon: FileText, color: '#10B981' },
    { id: 'chart', label: 'چارت', icon: Activity, color: '#06B6D4' },
    { id: 'treatments', label: 'درمان', icon: Stethoscope, color: '#8B5CF6', count: treatments.length },
    { id: 'payments', label: 'پرداخت', icon: Wallet, color: '#22C55E', count: payments.length },
    { id: 'installments', label: 'اقساط', icon: CreditCard, color: '#3B82F6', count: installments.length },
    { id: 'checks', label: 'چک‌ها', icon: ScrollText, color: '#F59E0B', count: checks.length },
    { id: 'safteh', label: 'سفته', icon: ScrollText, color: '#6366F1', count: safteh.length },
    { id: 'lab', label: 'لابراتوار', icon: FlaskConical, color: '#EC4899', count: labOrders.length },
    { id: 'implants', label: 'ایمپلنت', icon: Anchor, color: '#06B6D4', count: implants.length },
    { id: 'reminders', label: 'یادآوری', icon: BellRing, color: '#EF4444', count: reminders.length },
  ];

  return (
    <div className="space-y-4 min-w-0" data-testid="patient_record_workspace">
      {allergySafety.assistiveFreeTextAlerts.length > 0 && (
        <div className="rounded-2xl border-2 border-red-500/50 bg-red-50/95 p-3 space-y-2 shadow-sm">
          <div className="flex items-center justify-between gap-2 text-red-700 font-bold text-xs flex-wrap">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={17} className="text-red-600 shrink-0" />
              هشدار کمکی تصمیم‌گیری بالینی ({allergySafety.assistiveFreeTextAlerts.length} مورد)
            </span>
            <span className="text-[10px] bg-white px-2 py-0.5 rounded-lg border border-red-200">
              کمک‌تصمیم‌گیری (نیازمند تأیید پزشک)
            </span>
          </div>
          {allergySafety.assistiveFreeTextAlerts.map((alert, idx) => (
            <div key={`${alert.keyword}_${idx}`} className="text-[11px] bg-white/90 rounded-xl p-2 border border-red-200">
              <span className="font-bold text-red-700">{alert.titleFa}: </span>
              <span className="text-red-950 leading-relaxed font-medium">{alert.recommendationFa}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-2">
        <button onClick={onOpenGallery} className="min-h-[48px] flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-cyan-600 hover:bg-cyan-700 text-white text-[11px] font-bold shadow-md">
          <Camera size={14} /> گالری و OPG
        </button>
        {canViewFinance && financialReady && <button onClick={onOpenPrint} className="min-h-[48px] flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold shadow-md">
          <Printer size={14} /> فاکتور بیمه
        </button>}
        <button onClick={onOpenConsent} className="min-h-[48px] flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-md">
          <FileSignature size={14} /> رضایت‌نامه A4
        </button>
      </div>

      <div className="glass-card p-3 space-y-2" data-testid="patient_detail_clinical_journey">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-extrabold text-emerald-700">
            مسیر ویزیت فعلی (Encounter): {clinicalJourney.currentStageLabelFa} ({clinicalJourney.progressPercent.toLocaleString('fa-IR')}٪)
          </div>
          <span className="text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-lg">
            گام بعدی: {clinicalJourney.nextActionLabelFa}
          </span>
        </div>
        <ClinicalJourneyStepper journey={clinicalJourney} onContinue={(stage) => {
          const target = stageTabs[stage.id];
          if (target && (canViewFinance || !financialTabs.includes(target))) setTab(target);
          else onOpenAppointments?.();
        }} />
      </div>

      {canViewFinance && (financialReady ? <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-2" aria-label="خلاصه مالی پرونده">
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-gray-400">هزینه کل</p>
          <p className="text-sm font-bold text-gray-700">{totalCost.toLocaleString('fa-IR')}</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-gray-400">پرداخت‌شده</p>
          <p className="text-sm font-bold text-green-600">{totalPaid.toLocaleString('fa-IR')}</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-gray-400">باقی‌مانده</p>
          <p className={`text-sm font-bold ${balance > 0 ? 'text-red-500' : 'text-green-500'}`}>{balance.toLocaleString('fa-IR')}</p>
        </div>
      </div> : <p role="status" className="text-sm text-[var(--md-secondary)]">اطلاعات مالی کامل و به‌روز در دسترس نیست.</p>)}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(160px,220px)_minmax(0,1fr)] gap-3 items-start" data-testid="patient_record_adaptive_layout">
      <nav aria-label="بخش‌های پرونده بیمار" className="flex gap-1 p-1 rounded-xl bg-[var(--md-bg)] overflow-x-auto lg:overflow-visible lg:flex-col min-w-0" data-testid="patient_record_navigation">
        {tabs.filter(t => canViewFinance || !financialTabs.includes(t.id)).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'true' : undefined}
              data-testid={`patient_record_tab_${t.id}`}
              onClick={() => setTab(t.id)}
              className={`min-h-[48px] shrink-0 flex items-center justify-center lg:justify-start gap-2 py-2 px-3 rounded-lg text-sm font-semibold whitespace-nowrap focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--md-primary)] ${
                tab === t.id ? 'bg-[var(--md-surface)] text-[var(--md-primary)] shadow-sm' : 'text-[var(--md-text)]'
              }`}
            >
              <Icon size={13} />
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="text-[9px] px-1 rounded-full" style={{ background: `${t.color}20`, color: t.color }}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <section className="min-w-0 space-y-3" aria-label={tabs.find(item => item.id === tab)?.label} data-testid="patient_record_content">
      {tab === 'info' && <InfoTab patient={patient} />}
      {tab === 'chart' && <PalmerChart patientId={patient.id} />}
      {tab === 'treatments' && <TreatmentsTab patientId={patient.id} treatments={treatments} />}
      {financialTabs.includes(tab) && !financialReady && <p role="status" className="rounded-xl border border-[var(--md-border)] bg-[var(--md-surface)] p-4 text-sm text-[var(--md-text)]">اطلاعات مالی کامل نیست؛ پس از همگام‌سازی مجدد بررسی کنید.</p>}
      {financialReady && tab === 'payments' && <PaymentsTab patientId={patient.id} payments={payments} treatments={treatments} />}
      {financialReady && tab === 'installments' && <InstallmentsTab patientId={patient.id} installments={installments} />}
      {financialReady && tab === 'checks' && <ChecksTab patientId={patient.id} checks={checks} installments={installments} />}
      {financialReady && tab === 'safteh' && <SaftehTab patientId={patient.id} safteh={safteh} />}
      {tab === 'lab' && <LabTab patientId={patient.id} labOrders={labOrders} />}
      {tab === 'implants' && <ImplantsTab patientId={patient.id} implants={implants} />}
      {tab === 'reminders' && <RemindersTab patientId={patient.id} reminders={reminders} />}

      </section>
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button variant="secondary" color="#10B981" onClick={onEdit} className="flex-1">
          ویرایش پرونده
        </Button>
        <Button variant="danger" onClick={onDelete} className="flex-1">
          آرشیو / حذف پرونده
        </Button>
      </div>
    </div>
  );
}
