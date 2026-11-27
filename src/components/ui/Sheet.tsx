import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, ShieldCheck, Lock } from 'lucide-react';
import { HapticEngine, playTactileFeedback } from '@/lib/hapticsAudio';
import { useFocusTrap } from '@/platform/focusEngine';
import { useUpdateSafePointGuard } from '@/services/updates';

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  color?: string;
  layout?: 'form' | 'workspace';
  children: ReactNode;
};

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  icon,
  color = '#3B82F6',
  layout = 'form',
  children,
}: SheetProps) {
  const sheetGuardId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useUpdateSafePointGuard(
    `sheet_${sheetGuardId}`,
    open,
    `فرم باز: ${title || 'ثبت اطلاعات کلینیک'}`
  );
  useFocusTrap(dialogRef, open, { onEscape: onClose });

  const [swipeBackX, setSwipeBackX] = useState(0);
  const swipeRef = useRef<{ active: boolean; startX: number; startY: number }>({
    active: false,
    startX: 0,
    startY: 0,
  });

  useEffect(() => {
    if (!open) {
      setSwipeBackX(0);
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col justify-end sm:justify-center bg-slate-950/55 backdrop-blur-md animate-fade-in"
      dir="rtl"
      data-testid="fullscreen_modal_sheet"
      onClick={() => {
        playTactileFeedback('soft');
        onClose();
      }}
    >
      {/* Full-Screen Push Route on Mobile (100dvh), Centered Sheet on iPad/Desktop */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="ios27_registration_sheet"
        data-sheet-layout={layout}
        className={`ios27-sheet-surface relative w-full h-[100dvh] sm:h-[92dvh] mx-auto flex flex-col bg-[#F4F5F9] rounded-none sm:rounded-[32px] shadow-2xl overflow-hidden animate-scale-in border-0 sm:border sm:border-white/80 safe-top safe-bottom ${layout === 'workspace' ? 'max-w-7xl' : 'max-w-2xl'}`}
        style={{
          boxShadow: '0 -12px 48px rgba(15, 23, 42, 0.24), 0 20px 60px rgba(15, 23, 42, 0.28)',
          transform: swipeBackX < 0 ? `translateX(${swipeBackX}px)` : undefined,
          transition: swipeRef.current.active ? 'none' : 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
          if (e.clientX >= vw - 48) {
            swipeRef.current = { active: true, startX: e.clientX, startY: e.clientY };
          }
        }}
        onPointerMove={(e) => {
          if (!swipeRef.current.active) return;
          const dx = e.clientX - swipeRef.current.startX;
          const dy = Math.abs(e.clientY - swipeRef.current.startY);
          if (dy > 48 && Math.abs(dx) < 20) {
            swipeRef.current.active = false;
            setSwipeBackX(0);
            return;
          }
          if (dx < 0) {
            setSwipeBackX(Math.max(-180, dx * 0.85));
          }
        }}
        onPointerUp={(e) => {
          if (!swipeRef.current.active) return;
          const dx = e.clientX - swipeRef.current.startX;
          swipeRef.current.active = false;
          setSwipeBackX(0);
          if (dx < -72) {
            HapticEngine.selection();
            onClose();
          }
        }}
        onPointerCancel={() => {
          swipeRef.current.active = false;
          setSwipeBackX(0);
        }}
      >
        {/* Top Grabber Pill */}
        <div
          className="pt-2 pb-1 flex flex-col items-center justify-center bg-white/92 dark:bg-[#11202E]/95 backdrop-blur-2xl shrink-0 cursor-pointer"
          onClick={() => {
            playTactileFeedback('soft');
            onClose();
          }}
          data-testid="ios27_sheet_grabber_pill"
        >
          <div className="w-10 h-1.5 rounded-full bg-slate-300/90 dark:bg-slate-600/90 transition-transform active:scale-95" />
        </div>

        {/* Sticky Navigation Bar Header */}
        <header
          className="ios27-sheet-navbar sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white/92 dark:bg-[#11202E]/95 backdrop-blur-2xl border-b border-slate-200/85 dark:border-[#25394D] shrink-0"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => {
                playTactileFeedback('soft');
                onClose();
              }}
              aria-label="بازگشت و بستن"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 transition-all haptic active:scale-90 shrink-0"
            >
              <ArrowRight size={18} />
            </button>

            {icon && (
              <div
                className="w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-sm shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                  boxShadow: `0 4px 12px ${color}35`,
                }}
              >
                {icon}
              </div>
            )}

            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-black text-slate-900 dark:text-slate-100 truncate leading-tight">{title}</h2>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {subtitle || 'فرم ثبت تمام‌صفحه • مینادنتال'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              playTactileFeedback('soft');
              onClose();
            }}
            aria-label="بستن پنجره"
            data-testid="close_fullscreen_modal_btn"
            className="px-3.5 py-2 rounded-full flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/90 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold text-xs border border-slate-200/80 dark:border-slate-700 transition-all haptic active:scale-92 shrink-0 min-h-[40px]"
          >
            <X size={15} />
            <span>بستن</span>
          </button>
        </header>

        {/* Scrollable Inset Grouped Content Area */}
        <div
          className="flex-1 overflow-y-auto p-3.5 sm:p-5 pb-24 safe-bottom desktop-scroll"
          style={{ paddingBottom: 'calc(6rem + var(--keyboard-inset-bottom, 0px))' }}
        >
          <div className={`${layout === 'workspace' ? 'max-w-none' : 'max-w-2xl'} mx-auto min-w-0 space-y-3`}>{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  color?: string;
  /** Enables genuine 2-step confirmation (defaults to true for safety & zero-loss compliance) */
  twoStep?: boolean;
  /** Optional 4-digit PIN required on Step 2 */
  expectedPin?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تایید',
  color = '#EF4444',
  twoStep = true,
  expectedPin,
}: ConfirmDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const confirmDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(confirmDialogRef, open, { onEscape: onClose });

  useEffect(() => {
    if (open) {
      setStep(1);
      setPinInput('');
      setPinError(false);
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const handlePrimaryClick = () => {
    if (twoStep && step === 1) {
      playTactileFeedback('warning');
      setStep(2);
      return;
    }
    if (expectedPin && pinInput.trim() !== expectedPin) {
      playTactileFeedback('warning');
      setPinError(true);
      return;
    }
    playTactileFeedback('success');
    onConfirm();
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-6"
      dir="rtl"
      onClick={onClose}
      data-testid="two_step_confirm_dialog"
    >
      <div className="absolute inset-0 sheet-overlay animate-fade-in" />
      <div
        ref={confirmDialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative glass-card p-6 w-full max-w-sm animate-bounce-in bg-white/98 dark:bg-[#11202E] shadow-2xl border border-slate-200 dark:border-[#25394D]"
        style={{ borderRadius: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Two-Step Progress Pill */}
        {twoStep && (
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
              {step === 1 ? <ShieldCheck size={12} className="text-amber-600" /> : <Lock size={12} className="text-rose-600" />}
              {step === 1 ? 'تایید دو مرحله‌ای (گام ۱ از ۲)' : 'تایید نهایی (گام ۲ از ۲)'}
            </span>
            <div className="flex items-center gap-1">
              <span className="w-4 h-1.5 rounded-full" style={{ background: color }} />
              <span
                className="w-4 h-1.5 rounded-full transition-colors"
                style={{ background: step === 2 ? color : '#E2E8F0' }}
              />
            </div>
          </div>
        )}

        <h3 className="text-base font-black text-slate-800 dark:text-slate-100 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
          {step === 1
            ? message
            : 'برای اطمینان کامل و حفظ یکپارچگی اطلاعات کلینیک، تایید نهایی را لمس کنید (نسخه پشتیبان خودکار در گاوصندوق ضدحذف ذخیره می‌شود).'}
        </p>

        {step === 2 && expectedPin && (
          <div className="mb-4">
            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
              رمز تایید مدیر کلینیک:
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value);
                setPinError(false);
              }}
              placeholder="رمز ۴ رقمی..."
              className="ios27-input w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-center font-mono font-black tracking-widest text-sm"
            />
            {pinError && (
              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-1 text-center">
                رمز تایید اشتباه است.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              playTactileFeedback('soft');
              onClose();
            }}
            className="flex-1 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-all haptic active:scale-95"
          >
            انصراف
          </button>
          <button
            type="button"
            data-testid={step === 1 ? 'confirm_step_1_btn' : 'confirm_step_2_final_btn'}
            onClick={handlePrimaryClick}
            className="flex-1 py-2.5 rounded-2xl text-white font-extrabold text-sm hover:opacity-95 transition-all haptic active:scale-95"
            style={{
              background: step === 1 && twoStep ? '#334155' : color,
              boxShadow: `0 4px 14px ${(step === 1 && twoStep ? '#334155' : color)}40`,
            }}
          >
            {twoStep && step === 1 ? 'ادامه به گام ۲' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

