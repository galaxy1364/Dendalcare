import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyAppUpdateAtomically,
  updateCoordinator,
  type AtomicUpdateProgress,
  type UpdateSnapshot,
} from '@/lib/updateManager';
import { HapticEngine } from '@/platform/haptics';

export interface OtaUpdateSummary {
  version: string;
  build?: number;
  releaseId?: string;
  releaseNotes: string;
  publishedBy: string;
}

export interface UpdateProviderContextValue {
  updateSnapshot: UpdateSnapshot;
  updateAvailable: boolean;
  otaUpdateInfo: OtaUpdateSummary | null;
  installingUpdate: boolean;
  atomicProgress: AtomicUpdateProgress | null;
  applyUpdate: (forceEvenIfBusy?: boolean) => Promise<void>;
  deferUpdate: (minutes?: number) => void;
  checkUpdatesNow: () => Promise<void>;
  openNativeUpdateStore: () => void;
  handleRealtimeHint: (hint: { releaseId?: string; version?: string }) => Promise<void>;
}

const UpdateContext = createContext<UpdateProviderContextValue | null>(null);

export interface UpdateProviderProps {
  children: ReactNode;
  onToast?: (msg: string, ms?: number) => void;
  applyUpdateFn?: typeof applyAppUpdateAtomically;
}

/**
 * V10 P1 Modular Provider: UpdateCoordinator lifecycle & atomic OTA state.
 * Because React runs child useEffect hooks before parent useEffect hooks, placing
 * UpdateProvider around the shell bootstrap component ensures markShellCommitted()
 * completes before updateCoordinator.start() begins.
 */
export function UpdateProvider({
  children,
  onToast,
  applyUpdateFn = applyAppUpdateAtomically,
}: UpdateProviderProps) {
  const [updateSnapshot, setUpdateSnapshot] = useState<UpdateSnapshot>(() =>
    updateCoordinator.getSnapshot()
  );
  const [atomicProgress, setAtomicProgress] = useState<AtomicUpdateProgress | null>(null);
  const lastToastedInstalledReleaseIdRef = useRef<string | null>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  useEffect(() => {
    const unsubUpdate = updateCoordinator.subscribe((snap) => {
      setUpdateSnapshot(snap);
      if (
        snap.state === 'INSTALLED' &&
        snap.installed.releaseId &&
        lastToastedInstalledReleaseIdRef.current !== snap.installed.releaseId
      ) {
        lastToastedInstalledReleaseIdRef.current = snap.installed.releaseId;
        HapticEngine.success();
        onToastRef.current?.(
          `نسخه v${snap.installed.semver} (${snap.installed.releaseId}) پس از تأیید بوت با موفقیت فعال شد`,
          4500
        );
      }
    });
    const stopUpdateCoordinator = updateCoordinator.start();

    return () => {
      unsubUpdate();
      stopUpdateCoordinator();
    };
  }, []);

  const installingUpdate =
    updateSnapshot.state === 'DOWNLOADING' ||
    updateSnapshot.state === 'VERIFYING' ||
    updateSnapshot.state === 'ACTIVATING';

  const updateAvailable = Boolean(
    updateSnapshot.candidate &&
      (updateSnapshot.state === 'AVAILABLE' ||
        updateSnapshot.state === 'DOWNLOADING' ||
        updateSnapshot.state === 'VERIFYING' ||
        updateSnapshot.state === 'READY_TO_ACTIVATE' ||
        updateSnapshot.state === 'WAITING_FOR_SAFE_POINT' ||
        updateSnapshot.state === 'NATIVE_STORE_REQUIRED')
  );

  const otaUpdateInfo = useMemo<OtaUpdateSummary | null>(() => {
    if (!updateSnapshot.candidate) return null;
    const m = updateSnapshot.candidate.manifest;
    return {
      version: m.semver,
      build: m.releaseSequence,
      releaseId: m.releaseId,
      releaseNotes: m.releaseNotes,
      publishedBy: m.origin === 'ci_pipeline' ? 'انتشار رسمی مینادنتال' : 'بیلد محلی',
    };
  }, [updateSnapshot.candidate]);

  const applyUpdate = useCallback(async (forceEvenIfBusy = false) => {
    try {
      const snap = await applyUpdateFn({
        forceEvenIfBusy,
        reloadPage: true,
        onProgress: (p) => setAtomicProgress(p),
      });
      if (snap.state === 'FAILED' || snap.state === 'CHECK_FAILED') {
        HapticEngine.error();
        if (snap.error?.messageFa) {
          onToastRef.current?.(snap.error.messageFa, 4500);
        }
      } else if (snap.state === 'WAITING_FOR_SAFE_POINT') {
        HapticEngine.warning();
        onToastRef.current?.(
          'به‌روزرسانی تأیید شد و پس از تکمیل فرم‌ها و ارسال صف آفلاین فعال می‌شود.',
          4200
        );
      }
    } catch {
      HapticEngine.error();
    } finally {
      setTimeout(() => setAtomicProgress(null), 1200);
    }
  }, [applyUpdateFn]);

  const deferUpdate = useCallback((minutes = 30) => {
    updateCoordinator.deferCandidate(minutes);
  }, []);

  const checkUpdatesNow = useCallback(async () => {
    await updateCoordinator.checkForUpdates('manual');
  }, []);

  const openNativeUpdateStore = useCallback(() => {
    updateCoordinator.openNativeStoreAction();
  }, []);

  const handleRealtimeHint = useCallback(
    async (hint: { releaseId?: string; version?: string }) => {
      await updateCoordinator.handleRealtimeHint(hint);
    },
    []
  );

  const value = useMemo<UpdateProviderContextValue>(
    () => ({
      updateSnapshot,
      updateAvailable,
      otaUpdateInfo,
      installingUpdate,
      atomicProgress,
      applyUpdate,
      deferUpdate,
      checkUpdatesNow,
      openNativeUpdateStore,
      handleRealtimeHint,
    }),
    [
      updateSnapshot,
      updateAvailable,
      otaUpdateInfo,
      installingUpdate,
      atomicProgress,
      applyUpdate,
      deferUpdate,
      checkUpdatesNow,
      openNativeUpdateStore,
      handleRealtimeHint,
    ]
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdateProvider(): UpdateProviderContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error('useUpdateProvider must be used inside UpdateProvider');
  }
  return ctx;
}
