import { useCallback, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useUpdateSafePointGuard } from '@/services/updates';

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/**
 * Normalizes Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII (0-9)
 * for phone numbers, national IDs, amounts, and clinical codes.
 */
export function normalizePersianDigits(input: string): string {
  return String(input ?? '')
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - ARABIC_ZERO));
}

export type ValidationErrors<T extends Record<string, unknown>> = Partial<Record<keyof T, string>>;

export interface UseIntelligentFormOptions<T extends Record<string, unknown>> {
  initialValues: T;
  validate?: (values: T) => ValidationErrors<T>;
  onSubmit: (values: T) => Promise<void> | void;
  draftLabel?: string;
}

/**
 * GE-0003 Intelligent Form Engine Hook
 * - Deterministic schema validation & per-field touched error disclosure
 * - Tracks dirty drafts and registers an active Update Safe-Point guard + `data-unsaved-draft`
 *   so edge-back gestures and auto-updates never discard clinical entry in progress
 */
export function useIntelligentForm<T extends Record<string, unknown>>({
  initialValues,
  validate,
  onSubmit,
  draftLabel = 'فرم ثبت اطلاعات کلینیک',
}: UseIntelligentFormOptions<T>) {
  const formId = useId();
  const [values, setValues] = useState<T>(initialValues);
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [submitCount, setSubmitCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initialValues),
    [values, initialValues]
  );

  useUpdateSafePointGuard(`intelligent_form_${formId}`, isDirty || submitting, draftLabel);

  const errors = useMemo<ValidationErrors<T>>(
    () => (validate ? validate(values) : {}),
    [validate, values]
  );

  const visibleErrors = useMemo<ValidationErrors<T>>(() => {
    const out: ValidationErrors<T> = {};
    for (const key of Object.keys(errors) as Array<keyof T>) {
      if (submitCount > 0 || touched[key]) {
        out[key] = errors[key];
      }
    }
    return out;
  }, [errors, submitCount, touched]);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => ({ ...prev, [key]: true }));
    setServerError(null);
  }, []);

  const reset = useCallback(
    (nextValues?: T) => {
      setValues(nextValues ?? initialValues);
      setTouched({});
      setSubmitCount(0);
      setServerError(null);
    },
    [initialValues]
  );

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      setSubmitCount((c) => c + 1);
      setServerError(null);

      const nextErrors = validate ? validate(values) : {};
      if (Object.keys(nextErrors).length > 0) {
        return false;
      }

      setSubmitting(true);
      try {
        await onSubmit(values);
        return true;
      } catch (err) {
        setServerError(err instanceof Error ? err.message : 'ثبت اطلاعات با خطا مواجه شد.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, validate, values]
  );

  return {
    values,
    errors: visibleErrors,
    allErrors: errors,
    isDirty,
    submitting,
    serverError,
    setField,
    reset,
    handleSubmit,
  };
}

export interface IntelligentFormProps {
  onSubmit: (e: FormEvent) => void;
  isDirty?: boolean;
  submitting?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  errorSummary?: string | null;
  accentColor?: string;
  children: ReactNode;
  testId?: string;
}

/**
 * Keyboard-aware, RTL-safe Intelligent Form Shell with sticky footer actions
 * and WCAG 2.2 AA accessible error summary.
 */
export function IntelligentForm({
  onSubmit,
  isDirty = false,
  submitting = false,
  submitLabel = 'ذخیره اطلاعات',
  cancelLabel = 'انصراف',
  onCancel,
  errorSummary,
  accentColor = '#087C76',
  children,
  testId,
}: IntelligentFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      data-testid={testId || 'intelligent_form_engine'}
      data-unsaved-draft={isDirty ? 'true' : undefined}
      className="flex flex-col gap-[var(--md-density-section-gap,12px)]"
    >
      {errorSummary && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FFF1F2] dark:bg-[#2A1218] border border-[#FECDD3] dark:border-[#7F1D1D] px-3.5 py-2.5 text-xs font-bold text-[#AD293C] dark:text-[#FDA4AF] flex items-center gap-2"
        >
          <AlertCircle size={15} className="shrink-0" />
          <span>{errorSummary}</span>
        </div>
      )}

      <div className="space-y-[var(--md-density-row-gap,10px)]">{children}</div>

      <div
        className="sticky bottom-0 z-10 -mx-1 px-1 pt-2 bg-gradient-to-t from-[#F4F7F9] via-[#F4F7F9]/95 to-transparent dark:from-[#0A141E] dark:via-[#0A141E]/95 flex items-center gap-2"
        style={{ paddingBottom: 'calc(0.5rem + var(--keyboard-inset-bottom, 0px))' }}
      >
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="min-h-[46px] px-4 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-extrabold active:scale-95 transition-transform"
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 min-h-[46px] px-4 rounded-2xl text-white text-xs font-black inline-flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-transform disabled:opacity-65"
          style={{ background: accentColor }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          <span>{submitting ? 'در حال ثبت...' : submitLabel}</span>
        </button>
      </div>
    </form>
  );
}
