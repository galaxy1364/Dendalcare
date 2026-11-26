import { AlertCircle, Clock, Database, Lock, RefreshCw, WifiOff, Inbox } from 'lucide-react';
import type { TableDataStatus } from '@/lib/useRealtimeTable';

interface SectionStatusBannerProps {
  status: TableDataStatus;
  isStale?: boolean;
  errorMessage?: string | null;
  emptyText?: string;
  migrationTables?: string[];
  onRetry?: () => void;
}

export function SectionStatusBanner({
  status,
  isStale = false,
  errorMessage,
  emptyText = 'هنوز رکوردی ثبت نشده است.',
  migrationTables,
  onRetry,
}: SectionStatusBannerProps) {
  if (status === 'ready' && !isStale) return null;

  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="section_status_loading"
        className="rounded-card px-3.5 py-2.5 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] flex items-center gap-2.5 text-xs font-semibold text-[#526779] dark:text-[#9FB1C1]"
      >
        <span className="w-4 h-4 rounded-full border-2 border-[#087C76] border-t-transparent animate-spin shrink-0" />
        <span>در حال دریافت اطلاعات به‌روز از سرور کلینیک...</span>
      </div>
    );
  }

  if (status === 'migration_required') {
    const tablesText =
      migrationTables && migrationTables.length > 0
        ? ` (${migrationTables.slice(0, 4).join('، ')}${migrationTables.length > 4 ? ' و ...' : ''})`
        : '';
    return (
      <div
        role="alert"
        data-testid="section_status_migration_required"
        className="rounded-card px-3.5 py-2.5 bg-[#FFF1F2] dark:bg-[#2A1218] border border-[#FECDD3] dark:border-[#7F1D1D] flex items-center justify-between gap-2 text-xs font-bold text-[#AD293C] dark:text-[#FDA4AF]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Database size={16} className="shrink-0" />
          <span className="leading-snug">
            {errorMessage ||
              `به‌روزرسانی ساختار دیتابیس (Migration امنیتی tenant_id/branch_id) پیش از نمایش آمار الزامی است${tablesText}.`}
          </span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[40px] px-3 py-1 rounded-btn bg-white dark:bg-[#11202E] border border-[#FECDD3] dark:border-[#7F1D1D] text-[#AD293C] dark:text-[#FDA4AF] font-bold flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={13} />
            <span>بررسی مجدد</span>
          </button>
        )}
      </div>
    );
  }

  if (status === 'unauthorized') {
    const rawMsg = errorMessage || '';
    const isPermissionDenied = /permission denied|42501|not authorized|rls/i.test(rawMsg);
    return (
      <div
        role="alert"
        data-testid="section_status_unauthorized"
        className="rounded-card px-3.5 py-2.5 bg-[#FFF1F2] dark:bg-[#2A1218] border border-[#FECDD3] dark:border-[#7F1D1D] flex flex-wrap items-center justify-between gap-2.5 text-xs font-bold text-[#AD293C] dark:text-[#FDA4AF]"
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Lock size={16} className="shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <p className="leading-relaxed">
              {isPermissionDenied
                ? 'دسترسی ناشناس به پرونده بیماران برای امنیت داده‌ها مسدود است. لطفاً با حساب کاربری مجاز کلینیک وارد شوید.'
                : rawMsg || 'دسترسی این نقش به اطلاعات این بخش محدود است. لطفاً با حساب مجاز وارد شوید.'}
            </p>
            {isPermissionDenied && rawMsg && (
              <p dir="ltr" className="text-[11px] font-mono opacity-80 break-words">
                {rawMsg}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="section_status_open_auth_btn"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('minadental-open-auth-modal'));
              }
            }}
            className="min-h-[40px] px-3 py-1 rounded-btn bg-[#AD293C] hover:bg-[#931E30] text-white font-bold flex items-center gap-1 shrink-0 transition-colors"
          >
            <Lock size={13} />
            <span>ورود با حساب کلینیک</span>
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              data-testid="section_status_unauthorized_retry"
              className="min-h-[40px] px-3 py-1 rounded-btn bg-white dark:bg-[#11202E] border border-[#FECDD3] dark:border-[#7F1D1D] text-[#AD293C] dark:text-[#FDA4AF] font-bold flex items-center gap-1 shrink-0"
            >
              <RefreshCw size={13} />
              <span>بررسی مجدد</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === 'locked_offline') {
    return (
      <div
        role="alert"
        data-testid="section_status_locked_offline"
        className="rounded-card px-3.5 py-2.5 bg-[#FFF1F2] dark:bg-[#2A1218] border border-[#FECDD3] dark:border-[#7F1D1D] flex items-center justify-between gap-2 text-xs font-bold text-[#AD293C] dark:text-[#FDA4AF]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Lock size={16} className="shrink-0" />
          <span className="leading-snug">
            {errorMessage ||
              'حافظه رمزنگاری‌شده آفلاین پس از بارگذاری مجدد قفل شده است. برای مشاهده داده‌ها به اینترنت متصل شوید.'}
          </span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[40px] px-3 py-1 rounded-btn bg-white dark:bg-[#11202E] border border-[#FECDD3] dark:border-[#7F1D1D] text-[#AD293C] dark:text-[#FDA4AF] font-bold flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={13} />
            <span>اتصال مجدد</span>
          </button>
        )}
      </div>
    );
  }

  if (status === 'partial') {
    return (
      <div
        role="status"
        data-testid="section_status_partial"
        className="rounded-card px-3.5 py-2.5 bg-[#FFFBEB] dark:bg-[#291E0B] border border-[#FDE68A] dark:border-[#78350F] flex items-center justify-between gap-2 text-xs font-bold text-[#92510C] dark:text-[#FCD34D]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Database size={16} className="shrink-0" />
          <span className="leading-snug">
            {errorMessage ||
              'داده‌های نمایشی بخشی از رکوردها هستند (Partial). شاخص‌های مالی تا تکمیل همگام‌سازی سرور به‌صورت ناقص علامت‌گذاری شده‌اند.'}
          </span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[40px] px-3 py-1 rounded-btn bg-white dark:bg-[#11202E] border border-[#FDE68A] text-[#92510C] font-bold flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={13} />
            <span>تلاش مجدد</span>
          </button>
        )}
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div
        role="status"
        data-testid="section_status_offline"
        className="rounded-card px-3.5 py-2.5 bg-[#FFFBEB] dark:bg-[#291E0B] border border-[#FDE68A] dark:border-[#78350F] flex items-center justify-between gap-2 text-xs font-bold text-[#92510C] dark:text-[#FCD34D]"
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <WifiOff size={16} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            حالت آفلاین — نمایش نسخه رمزنگاری‌شده محلی (داده‌ها ممکن است به‌روز نباشند)
          </span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[40px] px-3 py-1 rounded-btn bg-white dark:bg-[#11202E] border border-[#FDE68A] text-[#92510C] font-bold shrink-0"
          >
            تلاش مجدد
          </button>
        )}
      </div>
    );
  }

  if (status === 'timeout') {
    return (
      <div
        role="alert"
        data-testid="section_status_timeout"
        className="rounded-card px-3.5 py-2.5 bg-[#FFFBEB] dark:bg-[#291E0B] border border-[#FDE68A] dark:border-[#78350F] flex items-center justify-between gap-2 text-xs font-bold text-[#92510C] dark:text-[#FCD34D]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Clock size={16} className="shrink-0" />
          <span className="leading-snug">
            {errorMessage || 'پاسخ سرور در زمان مجاز دریافت نشد (Timeout). لطفاً دوباره تلاش کنید.'}
          </span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid="section_status_timeout_retry"
            className="min-h-[40px] px-3 py-1 rounded-btn bg-white dark:bg-[#11202E] border border-[#FDE68A] text-[#92510C] font-bold flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={13} />
            <span>تلاش مجدد</span>
          </button>
        )}
      </div>
    );
  }

  if (status === 'error' || isStale) {
    return (
      <div
        role="alert"
        data-testid="section_status_error"
        className="rounded-card px-3.5 py-2.5 bg-[#FFF1F2] dark:bg-[#2A1218] border border-[#FECDD3] dark:border-[#7F1D1D] flex items-center justify-between gap-2 text-xs font-bold text-[#AD293C] dark:text-[#FDA4AF]"
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            {errorMessage || 'خطا در ارتباط با سرور کلینیک. داده‌های نمایش‌داده‌شده ممکن است ناقص باشند.'}
          </span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[40px] px-3 py-1 rounded-btn bg-white dark:bg-[#11202E] border border-[#FECDD3] text-[#AD293C] font-bold flex items-center gap-1 shrink-0"
          >
            <RefreshCw size={13} />
            <span>تلاش مجدد</span>
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
        className="rounded-card px-3.5 py-3 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] flex items-center gap-2.5 text-xs font-semibold text-[#526779] dark:text-[#9FB1C1]"
      >
        <Inbox size={16} className="shrink-0 text-[#087C76]" />
        <span>{emptyText}</span>
      </div>
    );
  }

  return null;
}
