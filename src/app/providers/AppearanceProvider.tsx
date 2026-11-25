import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { initAppearanceEngine } from '@/design-system/themes/appearance';
import {
  isHapticsEnabled,
  isSoundEnabled,
  setHapticsEnabled,
  setSoundEnabled,
} from '@/platform/haptics';
import {
  getDeviceNotificationPermission,
  isDeviceNotificationsEnabled,
  requestDeviceNotificationPermission,
  sendRealDeviceNotification,
  setDeviceNotificationsEnabled,
} from '@/lib/deviceNotifications';

export interface AppearanceProviderContextValue {
  hapticsOn: boolean;
  toggleHaptics: () => void;
  soundOn: boolean;
  toggleSound: () => void;
  deviceNotifOn: boolean;
  deviceNotifPerm: string;
  toggleDeviceNotif: (next: boolean) => void;
  requestDeviceNotif: () => Promise<void>;
  testDeviceNotif: (notifCount: number) => Promise<void>;
}

const AppearanceContext = createContext<AppearanceProviderContextValue | null>(null);

export interface AppearanceProviderProps {
  children: ReactNode;
  requestPermissionFn?: () => Promise<NotificationPermission | 'unsupported'>;
}

/**
 * V10 P1 Modular Provider: Appearance, Haptics, Audio Feedback & OS Device Notifications.
 * Independently owns initAppearanceEngine() lifecycle & user sensory/notification preferences.
 */
export function AppearanceProvider({
  children,
  requestPermissionFn = requestDeviceNotificationPermission,
}: AppearanceProviderProps) {
  const [hapticsOn, setHapticsOn] = useState(() => isHapticsEnabled());
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const [deviceNotifOn, setDeviceNotifOn] = useState(() => isDeviceNotificationsEnabled());
  const [deviceNotifPerm, setDeviceNotifPerm] = useState(() => getDeviceNotificationPermission());

  useEffect(() => {
    const cleanupAppearance = initAppearanceEngine();
    return () => {
      cleanupAppearance();
    };
  }, []);

  const toggleHaptics = useCallback(() => {
    setHapticsOn((prev) => {
      const next = !prev;
      setHapticsEnabled(next);
      return next;
    });
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      setSoundEnabled(next);
      return next;
    });
  }, []);

  const toggleDeviceNotif = useCallback((next: boolean) => {
    setDeviceNotificationsEnabled(next);
    setDeviceNotifOn(next);
  }, []);

  const requestDeviceNotif = useCallback(async () => {
    const perm = await requestPermissionFn();
    setDeviceNotifPerm(perm);
    const enabled = perm === 'granted';
    setDeviceNotifOn(enabled);
    if (enabled) {
      await sendRealDeviceNotification({
        title: 'مینادنتال متصل شد',
        body: 'یادآوری‌های کلینیک روی نوتیفیکیشن گوشی نمایش داده می‌شوند.',
        tag: 'minadental-connected',
      });
    }
  }, [requestPermissionFn]);

  const testDeviceNotif = useCallback(async (notifCount: number) => {
    await sendRealDeviceNotification({
      title: 'مینادنتال • تست اعلان گوشی',
      body: `${notifCount.toLocaleString('fa-IR')} یادآوری فعال در کلینیک ثبت شده است.`,
      tag: `minadental-test-${Date.now()}`,
    });
  }, []);

  const value = useMemo<AppearanceProviderContextValue>(
    () => ({
      hapticsOn,
      toggleHaptics,
      soundOn,
      toggleSound,
      deviceNotifOn,
      deviceNotifPerm,
      toggleDeviceNotif,
      requestDeviceNotif,
      testDeviceNotif,
    }),
    [
      hapticsOn,
      toggleHaptics,
      soundOn,
      toggleSound,
      deviceNotifOn,
      deviceNotifPerm,
      toggleDeviceNotif,
      requestDeviceNotif,
      testDeviceNotif,
    ]
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearanceProvider(): AppearanceProviderContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error('useAppearanceProvider must be used inside AppearanceProvider');
  }
  return ctx;
}
