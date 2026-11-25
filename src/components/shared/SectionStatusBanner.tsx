import { AlertTriangle, Lock, RefreshCw, WifiOff, Inbox } from 'lucide-react';
import type { TableDataStatus } from '@/lib/useRealtimeTable';

interface SectionStatusBannerProps {
  status: TableDataStatus;
  isStale?: boolean;
  errorMessage?: string | null;
  emptyText?: string;
  onRetry?: () => void;
}

export function SectionStatusBanner({
  status,
  isStale = false,
  errorMessage,
  emptyText = 'داده‌ای برای نمایش ثبت نشده است.',
  onRetry,
}: SectionStatusBannerProps) {
  if (status === 'ready' && !isStale) return null;

  if (status === 'loading') {
    return (
      <div
        role="status"
        data-testid="section_status_loading"
        className="rounded-btn px-3 py-2 bg-[#EEF3F7] dark:bg-slate-800 border border-[#D8E2EA] dark:border-slate-700 text-xs font-semibold text-[#526779] dark:text-slate-300 flex items-center gap-2"
      >
        <RefreshCw size={14} className="animate-spin text-[#087C76] shrink-0" />
        <span>در حال همگام‌سازی داده‌ها از سرور...</span>
      </div>
    );
  }

  if (status === 'unauthorized') {
    return (
      <div
        role="alert"
        data-testid="section_status_unauthorized"
        className="rounded-btn px-3 py-2.5 bg-[#FFF1F2] border border-[#FECDD3] text-[#AD293C] text-xs font-bold flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2">
          <Lock size={15} className="shrink-0" />
          <span>دسترسی این حساب کاربری به بخش یا داده‌های سرور محدود شده است.</span>
        </span>
      </div>
    );
  }

  if (status === 'offline' || isStale) {
    return (
      <div
        role="status"
        data-testid="section_status_offline_stale"
        className="rounded-btn px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] text-[#92510C] text-xs font-bold flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2">
          <WifiOff size={15} className="shrink-0" />
          <span>
            {status === 'offline'
              ? 'حالت آفلاین: نمایش آخرین وضعیت ذخیره‌شده محلی (ممکن است به‌روز نباشد).'
              : 'ارتباط با سرور کامل نشد؛ اطلاعات نمایش‌داده‌شده ممکن است به‌روز نباشند.'}
          </span>
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#FDE68A] text-[#92510C] text-[11px] font-bold shrink-0 min-h-[36px]"
          >
            تلاش مجدد
          </button>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        data-testid="section_status_error"
        className="rounded-btn px-3 py-2.5 bg-[#FFF1F2] border border-[#FECDD3] text-[#AD293C] text-xs font-bold flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          <span>{errorMessage || 'خطا در دریافت اطلاعات از سرور.'}</span>
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-2.5 py-1 rounded-lg bg-white border border-[#FECDD3] text-[#AD293C] text-[11px] font-bold shrink-0 min-h-[36px]"
          >
            تلاش مجدد
          </button>
        )}
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div
        role="status"
        data-testid="section_status_empty"
        className="rounded-btn px-3 py-2 bg-[#F4F7F9] dark:bg-slate-800 border border-[#D8E2EA] dark:border-slate-700 text-[#526779] dark:text-slate-300 text-xs font-semibold flex items-center gap-2"
      >
        <Inbox size={15} className="shrink-0" />
        <span>{emptyText}</span>
      </div>
    );
  }

  return null;
}
