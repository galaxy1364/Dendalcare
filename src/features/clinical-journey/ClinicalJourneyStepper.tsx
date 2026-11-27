import { useId, useState } from 'react';
import { AlertTriangle, Check, Circle, Clock3 } from 'lucide-react';
import type { ClinicalJourneyStageNode, PatientClinicalJourneySummary } from './patientJourney';

const labels = {
  completed: 'تکمیل‌شده در داده موجود',
  current: 'مرحله جاری',
  pending: 'در انتظار',
  attention: 'نیازمند بررسی',
} as const;
const styles = {
  completed: 'bg-emerald-700 border-emerald-700 text-white',
  current: 'bg-sky-700 border-sky-700 text-white',
  pending: 'bg-white dark:bg-slate-900 border-slate-400 text-slate-600 dark:text-slate-300',
  attention: 'bg-amber-100 border-amber-600 text-amber-900',
} as const;
const icons = { completed: Check, current: Clock3, pending: Circle, attention: AlertTriangle } as const;

type Props = {
  journey: PatientClinicalJourneySummary;
  onContinue: (stage: ClinicalJourneyStageNode) => void;
};

// Review and navigate only. Clinical completion remains derived from the encounter data;
// never modify clinical records or mark a stage complete in the browser.
export function ClinicalJourneyStepper({ journey, onContinue }: Props) {
  const panelId = useId();
  const [selection, setSelection] = useState<{ id: string; evidence: string; review: boolean } | null>(null);
  const evidence = (stage: ClinicalJourneyStageNode) =>
    JSON.stringify([journey.patientId, journey.activeEncounter.encounterAppointmentId,
      journey.activeEncounter.episodeStatus, stage.id, stage.state, stage.detailFa]);
  const selected = journey.stages.find(s => s.id === selection?.id && evidence(s) === selection.evidence);
  const review = Boolean(selected && selection?.review);

  return (
    <div dir="rtl" className="min-w-0 max-w-full space-y-2" data-testid="clinical_journey_stepper">
      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        برای بررسی، یک مرحله را انتخاب کنید. در نمایشگر کوچک، نوار را به چپ بکشید.
      </p>
      <div className="max-w-full min-w-0 overflow-x-auto overscroll-x-contain pb-2" data-testid="clinical_journey_scroll">
        <ol aria-label="مسیر بالینی نه مرحله‌ای" className="grid grid-cols-9 min-w-[792px] w-full list-none m-0 p-0">
          {journey.stages.map((stage, index) => {
            const Icon = icons[stage.state];
            const linked = stage.state === 'completed' && journey.stages[index + 1]?.state === 'completed';
            return (
              <li key={stage.id} className="relative min-w-0">
                {index < journey.stages.length - 1 && (
                  <span aria-hidden="true" style={{ insetInlineStart: '50%' }}
                    className={'absolute top-[22px] h-0.5 w-full ' + (linked ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600')} />
                )}
                <button type="button" data-testid={'clinical_stage_' + stage.id}
                  aria-label={stage.labelFa + ' — ' + labels[stage.state]}
                  aria-current={journey.currentStageId === stage.id ? 'step' : undefined}
                  aria-expanded={selected?.id === stage.id} aria-controls={selected?.id === stage.id ? panelId : undefined}
                  data-stage-state={stage.state}
                  onClick={() => setSelection({ id: stage.id, evidence: evidence(stage), review: false })}
                  className="relative w-full min-h-[88px] flex flex-col items-center gap-1.5 px-1 py-1 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-700">
                  <span aria-hidden="true" className={'w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0 ' + styles[stage.state]}>
                    <Icon size={17} />
                  </span>
                  <span className="text-xs font-bold leading-5 text-center text-slate-800 dark:text-slate-100 break-words whitespace-normal">{stage.labelFa}</span>
                  <span className="text-[11px] leading-4 text-center text-slate-600 dark:text-slate-300">
                    {stage.state === 'completed' ? 'تکمیل' : stage.state === 'current' ? 'جاری' : stage.state === 'attention' ? 'بررسی' : 'انتظار'}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {selected && (
        <section id={panelId} aria-label="بررسی مرحله بالینی" className="rounded-xl border border-slate-300 dark:border-slate-600 p-3 space-y-2 bg-white/80 dark:bg-slate-900">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300" aria-live="polite">
            {review ? 'گام ۲ از ۲: تأیید ادامه' : 'گام ۱ از ۲: بررسی اطلاعات'}
          </p>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{selected.labelFa}</h4>
          <p className="text-sm text-slate-700 dark:text-slate-200">{labels[selected.state]} — {selected.detailFa}</p>
          <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
            این تأیید فقط بخش مربوط به مرحله را باز می‌کند؛ به معنای ثبت یا تکمیل درمان نیست. وضعیت از داده‌های موجود محاسبه می‌شود و تأیید مستقل سرور در این نوار انجام نمی‌شود.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelection(null)} className="min-h-[44px] flex-1 rounded-xl border border-slate-400 px-3 text-sm font-bold text-slate-700 dark:text-slate-200">انصراف</button>
            <button type="button" data-testid={review ? 'clinical_stage_confirm' : 'clinical_stage_review'}
              onClick={() => {
                if (!review) { setSelection({ id: selected.id, evidence: evidence(selected), review: true }); return; }
                setSelection(null);
                onContinue(selected);
              }}
              className="min-h-[44px] flex-1 rounded-xl bg-sky-700 px-3 text-sm font-bold text-white">
              {review ? 'تأیید و باز کردن بخش' : 'ادامه به تأیید'}
            </button>
          </div>
        </section>
      )}
      {selection && !selected && <p role="status" className="text-xs text-amber-800 dark:text-amber-300">اطلاعات ویزیت تغییر کرد؛ مرحله را دوباره انتخاب کنید.</p>}
    </div>
  );
}
