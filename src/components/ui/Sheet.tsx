import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, ShieldCheck, Lock } from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  color?: string;
  children: ReactNode;
};

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  icon,
  color = '#3B82F6',
  children,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/65 backdrop-blur-xl animate-fade-in"
      dir="rtl"
      data-testid="fullscreen_modal_sheet"
    >
      {/* Full-Screen Container */}
      <div
        className="relative w-full h-[100dvh] max-w-3xl mx-auto flex flex-col bg-gradient-to-b from-white via-slate-50/98 to-white shadow-2xl overflow-hidden animate-scale-in"
        style={{
          borderTop: `4px solid ${color}`,
          boxShadow: `0 0 60px ${color}30`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Ambient Glow */}
        <div
          className="pointer-events-none absolute -top-20 right-1/4 w-72 h-40 rounded-full blur-3xl opacity-15"
          style={{ background: color }}
        />

        {/* Sticky Full-Screen Header */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between px-4 py-3.5 backdrop-blur-xl border-b border-gray-200/80 safe-top shrink-0"
          style={{
            background: `linear-gradient(135deg, ${color}12 0%, rgba(255,255,255,0.96) 100%)`,
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                playTactileFeedback('soft');
                onClose();
              }}
              aria-label="بازگشت و بستن"
              className="w-10 h-10 rounded-2xl flex items-center justify-center bg-white/90 hover:bg-gray-100 text-gray-700 border border-gray-200/80 shadow-sm transition-all haptic active:scale-90 shrink-0"
            >
              <ArrowRight size={19} />
            </button>

            {icon && (
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-md shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${color}, ${color}dd)`,
                  boxShadow: `0 4px 14px ${color}40`,
                }}
              >
                {icon}
              </div>
            )}

            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-gray-900 truncate">{title}</h2>
              <p className="text-[11px] text-gray-500 truncate">
                {subtitle || 'نمایش تمام‌صفحه • کلینیک هوشمند مینادنتال'}
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
            className="px-3 py-2 rounded-2xl flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs border border-rose-200/70 transition-all haptic active:scale-90 shrink-0"
          >
            <X size={16} />
            <span>بستن</span>
          </button>
        </header>

        {/* Scrollable Full-Screen Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 safe-bottom">
          <div className="max-w-2xl mx-auto">{children}</div>
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
        className="relative glass-card p-6 w-full max-w-sm animate-bounce-in bg-white/98 shadow-2xl"
        style={{ borderRadius: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Two-Step Progress Pill */}
        {twoStep && (
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
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

        <h3 className="text-base font-black text-slate-800 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          {step === 1
            ? message
            : 'برای اطمینان کامل و حفظ یکپارچگی اطلاعات کلینیک، تایید نهایی را لمس کنید (نسخه پشتیبان خودکار در گاوصندوق ضدحذف ذخیره می‌شود).'}
        </p>

        {step === 2 && expectedPin && (
          <div className="mb-4">
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
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
              className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-center font-mono font-black tracking-widest text-sm"
            />
            {pinError && (
              <p className="text-[11px] font-bold text-rose-600 mt-1 text-center">
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
            className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-all haptic active:scale-95"
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

