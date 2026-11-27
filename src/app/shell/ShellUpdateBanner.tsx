import { Sparkles } from 'lucide-react';
import type { AtomicUpdateProgress, UpdateSnapshot } from '@/lib/updateManager';

export interface ShellUpdateBannerProps {
  updateSnapshot: UpdateSnapshot;
  updateAvailable: boolean;
  otaUpdateInfo: {
    version: string;
    build?: number;
    releaseId?: string;
    releaseNotes: string;
    publishedBy: string;
  } | null;
  installingUpdate: boolean;
  atomicProgress: AtomicUpdateProgress | null;
  applyUpdate: (forceEvenIfBusy?: boolean) => Promise<void>;
  deferUpdate: (minutes?: number) => void;
  openNativeUpdateStore: () => void;
}

/**
 * GE-0005 Signed Atomic OTA Banner & Critical Update Activation Dialog:
 * Renders non-overlapping update prompts and safe-point activation controls.
 */
export function ShellUpdateBanner({
  updateSnapshot,
  updateAvailable,
  otaUpdateInfo,
  installingUpdate,
  atomicProgress,
  applyUpdate,
  deferUpdate,
  openNativeUpdateStore,
}: ShellUpdateBannerProps) {
  const showUpdateBanner =
    updateAvailable &&
    !(
      updateSnapshot.candidate?.deferredUntil &&
      Date.parse(updateSnapshot.candidate.deferredUntil) > Date.now() &&
      updateSnapshot.candidate.manifest.urgency !== 'critical'
    );

  return (
    <>
      {showUpdateBanner && (
        <div
          data-testid="top_atomic_update_banner"
          className="p-2.5 rounded-[16px] bg-[#EFF6FF] dark:bg-[#102338] text-[#14283B] dark:text-[#F1F5F9] border border-[#BFDBFE] dark:border-[#1E3A5F] animate-fade-in"
        >
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
            <div className="flex items-start gap-2 text-xs font-bold min-w-0 flex-1">
              <Sparkles size={16} className="text-[#0369A1] dark:text-[#38BDF8] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="block leading-snug">
                  {updateSnapshot.state === 'NATIVE_STORE_REQUIRED'
                    ? `نسخه جدید v${otaUpdateInfo?.version} (#${otaUpdateInfo?.build}) آماده دریافت است — بیلد نصب‌شده #${updateSnapshot.capabilities.nativeVersionCode ?? updateSnapshot.installed.releaseSequence}`
                    : updateSnapshot.state === 'WAITING_FOR_SAFE_POINT'
                    ? `نسخه v${otaUpdateInfo?.version} تأیید شد — در انتظار نقطه امن`
                    : updateSnapshot.state === 'READY_TO_ACTIVATE'
                    ? `نسخه v${otaUpdateInfo?.version} تأیید شد و آماده فعال‌سازی است`
                    : `انتشار جدید v${otaUpdateInfo?.version} (#${otaUpdateInfo?.build}) در دسترس است`}
                </span>
                {otaUpdateInfo?.releaseNotes && (
                  <span className="block text-[10px] font-medium text-[#526779] dark:text-[#9FB1C1] leading-snug mt-0.5">
                    {otaUpdateInfo.releaseNotes}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {updateSnapshot.candidate?.manifest.urgency !== 'critical' && !installingUpdate && (
                <button
                  type="button"
                  onClick={() => deferUpdate(30)}
                  data-testid="top_update_defer_btn"
                  className="min-h-[36px] px-2.5 py-1 rounded-[10px] bg-white dark:bg-[#162738] border border-[#BFDBFE] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] font-bold text-[11px]"
                >
                  بعداً
                </button>
              )}
              {updateSnapshot.state === 'NATIVE_STORE_REQUIRED' ? (
                <button
                  type="button"
                  onClick={openNativeUpdateStore}
                  data-testid="top_atomic_update_install_btn"
                  className="min-h-[36px] px-3 py-1 rounded-[10px] bg-[#0369A1] text-white font-bold text-xs"
                >
                  دریافت نسخه رسمی
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void applyUpdate(false)}
                  disabled={installingUpdate}
                  data-testid="top_atomic_update_install_btn"
                  className="min-h-[36px] px-3 py-1 rounded-[10px] bg-[#0369A1] text-white font-bold text-xs disabled:opacity-70"
                >
                  {installingUpdate
                    ? atomicProgress?.determinate && atomicProgress.percent !== null
                      ? `بررسی (${atomicProgress.percent}%)...`
                      : 'در حال تأیید...'
                    : updateSnapshot.state === 'WAITING_FOR_SAFE_POINT'
                    ? 'فعال‌سازی امن'
                    : 'دریافت و فعال‌سازی'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {updateSnapshot.candidate?.manifest.urgency === 'critical' &&
        updateSnapshot.state === 'READY_TO_ACTIVATE' && (
          <div
            role="dialog"
            aria-modal="true"
            data-testid="critical_update_modal"
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-5 space-y-3 shadow-xl">
              <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9]">
                به‌روزرسانی امنیتی ضروری آماده فعال‌سازی است
              </h2>
              <p className="text-xs text-[#526779] dark:text-[#9FB1C1] leading-relaxed">
                نسخه v{updateSnapshot.candidate.manifest.semver} ({updateSnapshot.candidate.manifest.releaseId}) دریافت و با SHA-256 تأیید شده است. تمامی پرونده‌ها، فرم‌های پیش‌نویس و صف آفلاین محفوظ می‌مانند.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void applyUpdate(false)}
                  className="flex-1 min-h-[42px] rounded-xl bg-[#087C76] text-white text-xs font-extrabold"
                >
                  ذخیره و فعال‌سازی اکنون
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
