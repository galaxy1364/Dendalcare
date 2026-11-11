import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight } from 'lucide-react';

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
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/75 backdrop-blur-xl animate-fade-in"
      dir="rtl"
      data-testid="fullscreen_modal_sheet"
    >
      {/* Full-Screen Container */}
      <div
        className="relative w-full h-[100dvh] max-w-3xl mx-auto flex flex-col bg-gradient-to-b from-white via-slate-50/98 to-white shadow-2xl overflow-hidden animate-scale-in"
        style={{
          borderTop: `4px solid ${color}`,
          boxShadow: `0 0 60px ${color}35`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Ambient Glow */}
        <div
          className="pointer-events-none absolute -top-20 right-1/4 w-72 h-40 rounded-full blur-3xl opacity-20"
          style={{ background: color }}
        />

        {/* Sticky Full-Screen Header */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between px-4 py-3.5 backdrop-blur-xl border-b border-gray-200/80 safe-top shrink-0"
          style={{
            background: `linear-gradient(135deg, ${color}16 0%, rgba(255,255,255,0.94) 100%)`,
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
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
                  boxShadow: `0 4px 14px ${color}45`,
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
            onClick={onClose}
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
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تایید',
  color = '#EF4444',
}: ConfirmDialogProps) {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-6"
      dir="rtl"
      onClick={onClose}
    >
      <div className="absolute inset-0 sheet-overlay animate-fade-in" />
      <div
        className="relative glass-card p-6 w-full max-w-sm animate-bounce-in bg-white/95"
        style={{ borderRadius: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-800 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-2xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 transition-all haptic active:scale-95"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 py-2.5 rounded-2xl text-white font-semibold text-sm hover:opacity-90 transition-all haptic active:scale-95"
            style={{
              background: color,
              boxShadow: `0 4px 14px ${color}40`,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
