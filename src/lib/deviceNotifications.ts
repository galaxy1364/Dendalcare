/**
 * MinaDental Real Device OS Notification Bridge
 * Trace ID: TRC-MINA-QBANK-9008-H
 *
 * Connects clinic Smart Reminder Radar directly to genuine OS/Browser Notifications
 * (Web Notification API + ServiceWorkerRegistration.showNotification) with deduplication.
 */

const DEVICE_NOTIF_ENABLED_KEY = 'minadental_device_notifications_enabled';
const SENT_NOTIF_TAGS_KEY = 'minadental_device_notif_sent_tags_v1';

export type DeviceNotifPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function getDeviceNotificationPermission(): DeviceNotifPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as DeviceNotifPermission;
}

export function isDeviceNotificationsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem(DEVICE_NOTIF_ENABLED_KEY);
    return saved === 'true' && getDeviceNotificationPermission() === 'granted';
  } catch {
    return false;
  }
}

export function setDeviceNotificationsEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEVICE_NOTIF_ENABLED_KEY, String(enabled));
    }
  } catch {
    // ignore
  }
}

export async function requestDeviceNotificationPermission(): Promise<DeviceNotifPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setDeviceNotificationsEnabled(true);
    } else {
      setDeviceNotificationsEnabled(false);
    }
    return permission as DeviceNotifPermission;
  } catch {
    return 'denied';
  }
}

export async function sendRealDeviceNotification(params: {
  title: string;
  body: string;
  tag?: string;
  urgent?: boolean;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const options: NotificationOptions = {
    body: params.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: params.tag || `minadental-${Date.now()}`,
    dir: 'rtl',
    lang: 'fa-IR',
    requireInteraction: Boolean(params.urgent),
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(params.title, options);
        return true;
      }
    }
  } catch {
    // fallback to direct Notification constructor
  }

  try {
    new Notification(params.title, options);
    return true;
  } catch {
    return false;
  }
}

function loadSentTags(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SENT_NOTIF_TAGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSentTags(map: Record<string, string>): void {
  try {
    localStorage.setItem(SENT_NOTIF_TAGS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/**
 * Syncs urgent/today smart clinic alerts to genuine device OS notifications
 * once per day per alert ID to avoid duplicate spam.
 */
export async function syncSmartAlertsToDeviceNotifications(
  alerts: Array<{ id: string; title: string; subtitle: string; urgency: string }>
): Promise<number> {
  if (!isDeviceNotificationsEnabled()) return 0;
  const todayKey = new Date().toISOString().slice(0, 10);
  const sent = loadSentTags();
  let dispatched = 0;

  const urgentAlerts = alerts.filter((a) => a.urgency === 'critical' || a.urgency === 'today').slice(0, 3);
  for (const alert of urgentAlerts) {
    const dedupKey = `${alert.id}_${todayKey}`;
    if (sent[dedupKey]) continue;
    const ok = await sendRealDeviceNotification({
      title: `مینادنتال • ${alert.title}`,
      body: alert.subtitle,
      tag: dedupKey,
      urgent: alert.urgency === 'critical',
    });
    if (ok) {
      sent[dedupKey] = new Date().toISOString();
      dispatched++;
    }
  }

  if (dispatched > 0) {
    saveSentTags(sent);
  }
  return dispatched;
}
