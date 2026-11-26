import {
  Archive,
  CheckCircle2,
  ShieldAlert,
  UploadCloud,
  WifiOff,
  X,
} from 'lucide-react';
import type { GuardianToastState } from '../AppProviders';
import { ShellUpdateBanner, type ShellUpdateBannerProps } from './ShellUpdateBanner';

interface ShellStatusBannersProps extends ShellUpdateBannerProps {
  isOnline: boolean;
  notifOpen: boolean;
  deniedRouteNotice: string | null;
  clearDeniedNotice: () => void;
  liveSyncToast: string | null;
  guardianToast: GuardianToastState | null;
  dismissGuardianToast: () => void;
  offlineQueueCount: number;
  flushingQueue: boolean;
  flushOfflineQueue: () => void;
  clearQueue: () => void;
}

/**
 * GE-0005 Unified Shell Status, Offline, Guardian & Atomic Update Banner Stack:
 * Keeps all global connectivity, RBAC, offline-queue, and signed OTA notices non-overlapping,
 * WCAG AA high-contrast, and cleanly wrapped across 320px–1920px viewports.
 */
export function ShellStatusBanners({
  isOnline,
  notifOpen,
  deniedRouteNotice,
  clearDeniedNotice,
  liveSyncToast,
  guardianToast,
  dismissGuardianToast,
  offlineQueueCount,
  flushingQueue,
  flushOfflineQueue,
  clearQueue,
  ...updateProps
}: ShellStatusBannersProps) {
  return (
    <>
      {!isOnline && (
        <div
          role="status"
          className="rounded-[12px] bg-[#92510C] text-white text-xs font-bold py-1.5 px-3 flex items-center justify-center gap-2"
        >
          <WifiOff size={15} className="shrink-0" />
          <span>حالت آفلاین (استفاده از کش محلی)</span>
        </div>
      )}

      {deniedRouteNotice && (
        <div
          role="alert"
          className="px-3 py-2 rounded-[12px] bg-[#FFF1F2] dark:bg-[#2A1218] border border-[#FECDD3] dark:border-[#7F1D1D] text-[#AD293C] dark:text-[#FDA4AF] text-xs font-bold flex items-center justify-between gap-2"
        >
          <span className="leading-relaxed">دسترسی نقش فعلی به بخش «{deniedRouteNotice}» محدود شده است.</span>
          <button
            type="button"
            onClick={clearDeniedNotice}
            aria-label="بستن پیام محدودیت"
            className="p-1.5 rounded-lg bg-white dark:bg-[#11202E] border border-[#FECDD3] dark:border-[#7F1D1D] shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {!notifOpen && (
        <>
          {liveSyncToast && (
            <div
              role="status"
              className="px-3.5 py-2 rounded-[14px] bg-[#ECFDF5] dark:bg-[#0D2B22] border border-[#B7E4CE] dark:border-[#1B5E48] text-[#0F4B39] dark:text-[#6EE7B7] text-xs font-bold flex items-center justify-center gap-2 animate-fade-in"
            >
              <CheckCircle2 size={15} className="text-[#176B52] dark:text-[#34D399] shrink-0" />
              <span className="leading-relaxed">{liveSyncToast}</span>
            </div>
          )}

          {guardianToast && (
            <div
              role="alert"
              data-testid="guardian_security_toast"
              className={`px-3.5 py-2 rounded-[14px] text-xs font-bold flex items-center justify-between gap-2 border animate-fade-in ${
                guardianToast.severity === 'security'
                  ? 'bg-[#FFF1F2] dark:bg-[#2A1218] border-[#FECDD3] dark:border-[#7F1D1D] text-[#AD293C] dark:text-[#FDA4AF]'
                  : guardianToast.severity === 'offline'
                  ? 'bg-[#FFFBEB] dark:bg-[#291E0B] border-[#FDE0A6] dark:border-[#78350F] text-[#92510C] dark:text-[#FCD34D]'
                  : 'bg-[#ECFDF5] dark:bg-[#0D2B22] border-[#B7E4CE] dark:border-[#1B5E48] text-[#176B52] dark:text-[#6EE7B7]'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                {guardianToast.severity === 'security' ? (
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                ) : guardianToast.severity === 'offline' ? (
                  <WifiOff size={16} className="shrink-0 mt-0.5" />
                ) : (
                  <Archive size={16} className="shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <span className="leading-snug block">{guardianToast.message}</span>
                  <span className="text-[10px] font-mono opacity-80">{guardianToast.traceId}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissGuardianToast}
                aria-label="بستن هشدار"
                className="p-1.5 rounded-lg bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {offlineQueueCount > 0 && (
            <div
              data-testid="offline_queue_pending_pill"
              className="px-3.5 py-2 rounded-[14px] bg-[#FFFBEB] dark:bg-[#291E0B] border border-[#FDE0A6] dark:border-[#78350F] text-[#92510C] dark:text-[#FCD34D] text-[11px] font-bold flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 animate-fade-in"
            >
              <div className="flex items-center gap-2 min-w-0">
                <UploadCloud size={15} className="shrink-0" />
                <span className="leading-snug">
                  {offlineQueueCount.toLocaleString('fa-IR')} تغییر در صف آفلاین آماده ارسال است
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={flushOfflineQueue}
                  disabled={flushingQueue}
                  data-testid="flush_offline_queue_button"
                  className="min-h-[36px] px-2.5 py-1 rounded-[10px] bg-[#92510C] text-white font-bold text-[11px] disabled:opacity-60"
                >
                  {flushingQueue ? 'ارسال...' : 'ارسال آنی'}
                </button>
                <button
                  type="button"
                  onClick={clearQueue}
                  data-testid="clear_offline_queue_button"
                  className="min-h-[36px] px-2 py-1 rounded-[10px] bg-white dark:bg-[#11202E] border border-[#FDE0A6] dark:border-[#78350F] text-[#92510C] dark:text-[#FCD34D] font-bold text-[11px]"
                >
                  پاک‌سازی
                </button>
              </div>
            </div>
          )}

          <ShellUpdateBanner {...updateProps} />
        </>
      )}
    </>
  );
}
