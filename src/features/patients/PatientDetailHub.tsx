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
import { computePatientClinicalJourney } from '@/features/clinical-journey/patientJourney';
import { assessPatientAllergySafety } from '@/features/clinical-record/clinicalRecordService';
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

export function PatientDetail({
  patient, appointments, treatments, payments, labOrders, implants, reminders, installments, checks, safteh,
  onEdit, onDelete, onOpenGallery, onOpenPrint, onOpenConsent,
}: {
  patient: Patient;
  appointments: Appointment[];
  treatments: Treatment[];
  payments: Payment[];
  labOrders: LabOrder[];
  implants: Implant[];
  reminders: Reminder[];
  installments: Installment[];
  checks: CheckType[];
  safteh: Safteh[];
  onEdit: () => void;
  onDelete: () => void;
  onOpenGallery: () => void;
  onOpenPrint: () => void;
  onOpenConsent: () => void;
}) {
  const [tab, setTab] = useState<PatientTab>('info');
  const totalCost = treatments.reduce((s, t) => s + Number(t.total_cost), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = totalCost - totalPaid;
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
    <div className="space-y-4">
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

      <div className="grid grid-cols-3 gap-2">
        <button onClick={onOpenGallery} className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-cyan-600 hover:bg-cyan-700 text-white text-[11px] font-bold shadow-md">
          <Camera size={14} /> گالری و OPG
        </button>
        <button onClick={onOpenPrint} className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold shadow-md">
          <Printer size={14} /> فاکتور بیمه
        </button>
        <button onClick={onOpenConsent} className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-md">
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
        <div className="grid grid-cols-3 sm:grid-cols-9 gap-1">
          {clinicalJourney.stages.map((st) => (
            <div
              key={st.id}
              className={`rounded-xl p-1.5 text-center border ${
                st.state === 'current' || st.state === 'attention'
                  ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                  : st.state === 'completed'
                  ? 'bg-emerald-50/50 border-emerald-200 text-emerald-700'
                  : 'bg-slate-50 border-transparent text-slate-400'
              }`}
            >
              <div className="text-[9.5px] font-extrabold truncate">{st.shortLabelFa}</div>
              <div className="text-[8px] opacity-80 truncate">{st.detailFa}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
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
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-gray-100/80 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${
                tab === t.id ? 'bg-white shadow-sm' : 'text-gray-400'
              }`}
              style={tab === t.id ? { color: t.color } : undefined}
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
      </div>

      {tab === 'info' && <InfoTab patient={patient} />}
      {tab === 'chart' && <PalmerChart patientId={patient.id} />}
      {tab === 'treatments' && <TreatmentsTab patientId={patient.id} treatments={treatments} />}
      {tab === 'payments' && <PaymentsTab patientId={patient.id} payments={payments} treatments={treatments} />}
      {tab === 'installments' && <InstallmentsTab patientId={patient.id} installments={installments} />}
      {tab === 'checks' && <ChecksTab patientId={patient.id} checks={checks} installments={installments} />}
      {tab === 'safteh' && <SaftehTab patientId={patient.id} safteh={safteh} />}
      {tab === 'lab' && <LabTab patientId={patient.id} labOrders={labOrders} />}
      {tab === 'implants' && <ImplantsTab patientId={patient.id} implants={implants} />}
      {tab === 'reminders' && <RemindersTab patientId={patient.id} reminders={reminders} />}

      <div className="flex gap-2 pt-2">
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
