import { useState, useEffect } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import { checkForAppUpdates, applyAppUpdateAtomically, getInstalledReleaseInfo } from '@/lib/updateManager';
import { HapticEngine } from '@/lib/hapticsAudio';
import { PlatformHapticAdapter } from '@/platform/haptics';

/**
 * ReleaseWatcher Component:
 * - Polls 'release-pointer.json' every 60 seconds.
 * - Uses document visibility API to pause polling when inactive/hidden.
 * - Notifies user via an in-app toast banner when a newer 'releaseSequence' is detected,
 *   providing a one-click 'Update and Reload' action.
 */
export function ReleaseWatcher() {
  const [updateAvailable, setUpdateAvailable] = useState<{
    latestVersion: string;
    latestBuild: number;
    releaseNotes: string;
  } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const checkNow = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      try {
        const res = await checkForAppUpdates();
        if (!isMounted) return;
        const current = getInstalledReleaseInfo();
        if (res.updateAvailable && res.latestBuild > current.build) {
          setUpdateAvailable({
            latestVersion: res.latestVersion,
            latestBuild: res.latestBuild,
            releaseNotes: res.releaseNotes,
          });
          setToastVisible(true);
        }
      } catch {
        // silent check background failure
      }
    };

    const scheduleNext = () => {
      if (timer) clearTimeout(timer);
      const interval = document.visibilityState === 'visible' ? 60_000 : 180_000;
      timer = setTimeout(async () => {
        await checkNow();
        if (isMounted) scheduleNext();
      }, interval);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkNow();
        scheduleNext();
      } else if (timer) {
        clearTimeout(timer);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    void checkNow();
    scheduleNext();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const handleUpdateAndReload = async () => {
    PlatformHapticAdapter.success();
    setUpdating(true);
    try {
      await applyAppUpdateAtomically({ reloadPage: true });
    } catch {
      setUpdating(false);
    }
  };

  if (!toastVisible || !updateAvailable) return null;

  return (
    <aside
      aria-label="اطلاعیه به‌روزرسانی جدید"
      data-testid="release_watcher_toast"
      className="fixed bottom-16 left-3 right-3 sm:left-auto sm:right-6 sm:w-96 z-50 animate-slide-down"
    >
      <div className="glass-card p-3.5 bg-slate-900/95 dark:bg-slate-900/98 text-white border border-indigo-500/40 shadow-xl rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm animate-pulse">
          <Zap size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-black text-white flex items-center gap-1.5 truncate">
            <span>نسخه جدید v{updateAvailable.latestVersion} (#{updateAvailable.latestBuild}) منتشر شد</span>
          </h4>
          <p className="text-[10.5px] text-slate-300 font-semibold truncate mt-0.5">
            {updateAvailable.releaseNotes}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="release_watcher_update_btn"
            disabled={updating}
            onClick={handleUpdateAndReload}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-[11px] font-black shadow-sm transition-all flex items-center gap-1 disabled:opacity-50"
          >
            {updating ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            <span>نصب و بازنشانی</span>
          </button>
          <button
            type="button"
            aria-label="بستن اطلاعیه"
            onClick={() => setToastVisible(false)}
            className="w-7 h-7 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
          >
            ✕
          </button>
        </div>
      </div>
    </aside>
  );
}
