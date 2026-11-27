/**
 * MinaDental Zero-Loss Global Reminder & Real Device OS Notification Engine
 * Trace ID: TRC-MINA-QBANK-9008-H / TRC-MINA-XPLAT-9009-I
 *
 * Best-effort reminder tracking via a dual-channel architecture:
 * 1. Persistent Zero-Loss Ledger in localStorage (tracks unacknowledged, snoozed, and acknowledged alerts across reloads/offline).
 * 2. Real Device OS Notification Bridge (ServiceWorkerRegistration.showNotification + Web Notification API).
 * 3. Internal iOS 27 Dynamic Island / Live Activity Popup Queue with Snooze (15m / 1h) and Explicit Acknowledgement.
 */

const DEVICE_NOTIF_ENABLED_KEY = 'minadental_device_notifications_enabled';
const SENT_NOTIF_TAGS_KEY = 'minadental_device_notif_sent_tags_v1';
const ZERO_LOSS_LEDGER_KEY = 'minadental_zero_loss_notif_ledger_v1';

export type DeviceNotifPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface ZeroLossLedgerEntry {
  alertId: string;
  title: string;
  subtitle: string;
  domain: string;
  urgency: 'critical' | 'today' | 'upcoming' | 'normal';
  targetSection: string;
  patientName?: string;
  patientPhone?: string | null;
  amount?: number;
  dueDate?: string;
  firstSeenAt: string;
  lastSurfacedAt: string;
  status: 'unacknowledged' | 'snoozed' | 'acknowledged';
  snoozeUntil?: number;
  acknowledgedAt?: string;
  osDispatched: boolean;
}

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
    const perm = getDeviceNotificationPermission();
    // Auto-enable when browser permission is already granted unless explicitly turned off
    if (saved === null && perm === 'granted') {
      return true;
    }
    return saved === 'true' && perm === 'granted';
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

  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: 'برای مشاهده جزئیات، وارد برنامه شوید.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: params.tag || `minadental-${Date.now()}`,
    dir: 'rtl',
    lang: 'fa-IR',
    requireInteraction: Boolean(params.urgent),
    renotify: true,
    vibrate: params.urgent ? [220, 90, 220, 90, 280] : [140, 70, 140],
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification('مینادنتال — یادآوری کلینیک', options);
        return true;
      }
    }
  } catch {
    // fallback to direct Notification constructor
  }

  try {
    new Notification('مینادنتال — یادآوری کلینیک', options);
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
 * Loads the persistent Zero-Loss Notification Ledger from localStorage.
 */
// Keep only acknowledgement metadata. Never persist alert text or patient/financial details.
function minimizeLedger(ledger: unknown): Record<string, ZeroLossLedgerEntry> {
  const result: Record<string, ZeroLossLedgerEntry> = Object.create(null);
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return result;
  for (const [key, value] of Object.entries(ledger)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<ZeroLossLedgerEntry>;
    if (typeof entry.alertId !== 'string' ||
        typeof entry.firstSeenAt !== 'string' ||
        typeof entry.lastSurfacedAt !== 'string' ||
        (entry.status !== 'unacknowledged' && entry.status !== 'snoozed' && entry.status !== 'acknowledged')) continue;
    result[key] = {
      alertId: entry.alertId,
      title: '',
      subtitle: '',
      domain: 'general',
      urgency: 'today',
      targetSection: 'reminders',
      firstSeenAt: entry.firstSeenAt,
      lastSurfacedAt: entry.lastSurfacedAt,
      status: entry.status,
      snoozeUntil: typeof entry.snoozeUntil === 'number' && Number.isFinite(entry.snoozeUntil) ? entry.snoozeUntil : undefined,
      acknowledgedAt: typeof entry.acknowledgedAt === 'string' ? entry.acknowledgedAt : undefined,
      osDispatched: entry.osDispatched === true,
    };
  }
  return result;
}

export function loadZeroLossLedger(): Record<string, ZeroLossLedgerEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ZERO_LOSS_LEDGER_KEY);
    if (!raw) return Object.create(null);
    const minimized = minimizeLedger(JSON.parse(raw));
    const serialized = JSON.stringify(minimized);
    // In-place migration preserves acknowledgement and snooze state.
    if (serialized !== raw) {
      try { localStorage.setItem(ZERO_LOSS_LEDGER_KEY, serialized); } catch { /* storage unavailable */ }
    }
    return minimized;
  } catch {
    return {};
  }
}

export function saveZeroLossLedger(ledger: Record<string, ZeroLossLedgerEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ZERO_LOSS_LEDGER_KEY, JSON.stringify(minimizeLedger(ledger)));
  } catch {
    // ignore storage errors
  }
}

/**
 * Synchronizes all live smart alerts and stored pending reminders into the Zero-Loss Ledger
 * and returns the ordered list of active unacknowledged (or expired-snooze) alerts that must
 * be surfaced in the iOS 27 Internal Reminder Popup and/or Phone OS Notification Center.
 */
export function reconcileZeroLossAlerts<
  T extends {
    id: string;
    title: string;
    subtitle: string;
    domain: string;
    urgency: 'critical' | 'today' | 'upcoming' | 'normal';
    targetSection: string;
    patientName?: string;
    patientPhone?: string | null;
    amount?: number;
    dueDate?: string;
  }
>(alerts: T[]): T[] {
  const ledger = loadZeroLossLedger();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const todayKey = nowIso.slice(0, 10);
  let mutated = false;

  const activePopupQueue: T[] = [];

  for (const alert of alerts) {
    const key = `${alert.id}_${todayKey}`;
    const existing = ledger[key];

    if (!existing) {
      ledger[key] = {
        alertId: alert.id,
        title: '',
        subtitle: '',
        domain: 'general',
        urgency: 'today',
        targetSection: 'reminders',
        firstSeenAt: nowIso,
        lastSurfacedAt: nowIso,
        status: 'unacknowledged',
        osDispatched: false,
      };
      mutated = true;
      activePopupQueue.push(alert);
    } else if (existing.status === 'snoozed') {
      if (!existing.snoozeUntil || now >= existing.snoozeUntil) {
        existing.status = 'unacknowledged';
        existing.snoozeUntil = undefined;
        existing.lastSurfacedAt = nowIso;
        mutated = true;
        activePopupQueue.push(alert);
      }
    } else if (existing.status === 'unacknowledged') {
      activePopupQueue.push(alert);
    }
  }

  if (mutated) {
    saveZeroLossLedger(ledger);
  }

  return activePopupQueue;
}

/**
 * Marks a reminder as explicitly acknowledged by the user so it leaves the active popup banner
 * while remaining safely logged in the Zero-Loss Ledger for today.
 */
export function acknowledgeZeroLossAlert(alertId: string): void {
  const ledger = loadZeroLossLedger();
  const todayKey = new Date().toISOString().slice(0, 10);
  const key = `${alertId}_${todayKey}`;
  if (ledger[key]) {
    ledger[key].status = 'acknowledged';
    ledger[key].acknowledgedAt = new Date().toISOString();
  } else {
    ledger[key] = {
      alertId,
      title: '',
      subtitle: '',
      domain: 'general',
      urgency: 'today',
      targetSection: 'reminders',
      firstSeenAt: new Date().toISOString(),
      lastSurfacedAt: new Date().toISOString(),
      status: 'acknowledged',
      acknowledgedAt: new Date().toISOString(),
      osDispatched: true,
    };
  }
  saveZeroLossLedger(ledger);
}

/**
 * Snoozes a reminder for a specified number of minutes (e.g. 15m or 60m).
 * Once the timer expires, it automatically re-enters the iOS 27 internal popup and phone notification queue.
 */
export function snoozeZeroLossAlert(alertId: string, minutes: number = 15): void {
  const ledger = loadZeroLossLedger();
  const todayKey = new Date().toISOString().slice(0, 10);
  const key = `${alertId}_${todayKey}`;
  const snoozeUntil = Date.now() + minutes * 60 * 1000;
  if (ledger[key]) {
    ledger[key].status = 'snoozed';
    ledger[key].snoozeUntil = snoozeUntil;
  } else {
    ledger[key] = {
      alertId,
      title: '',
      subtitle: '',
      domain: 'general',
      urgency: 'today',
      targetSection: 'reminders',
      firstSeenAt: new Date().toISOString(),
      lastSurfacedAt: new Date().toISOString(),
      status: 'snoozed',
      snoozeUntil,
      osDispatched: false,
    };
  }
  saveZeroLossLedger(ledger);
}

/**
 * Resets all acknowledged or snoozed alerts for today so every single active reminder
 * is immediately re-surfaced in the iOS 27 Popup & Phone OS Notification Center.
 */
export function resetAllZeroLossAlertsForToday(): void {
  const ledger = loadZeroLossLedger();
  const todayKey = new Date().toISOString().slice(0, 10);
  for (const key of Object.keys(ledger)) {
    if (key.endsWith(`_${todayKey}`)) {
      ledger[key].status = 'unacknowledged';
      ledger[key].snoozeUntil = undefined;
    }
  }
  saveZeroLossLedger(ledger);
}

/**
 * Syncs urgent/today smart clinic alerts to genuine device OS notifications
 * once per day per alert ID to avoid duplicate spam, while recording OS delivery in the Zero-Loss Ledger.
 */
export async function syncSmartAlertsToDeviceNotifications(
  alerts: Array<{ id: string; title: string; subtitle: string; urgency: string }>
): Promise<number> {
  if (!isDeviceNotificationsEnabled()) return 0;
  const todayKey = new Date().toISOString().slice(0, 10);
  const sent = loadSentTags();
  const ledger = loadZeroLossLedger();
  let dispatched = 0;

  const urgentAlerts = alerts.filter((a) => a.urgency === 'critical' || a.urgency === 'today').slice(0, 4);
  for (const alert of urgentAlerts) {
    const dedupKey = `${alert.id}_${todayKey}`;
    if (sent[dedupKey]) continue;
    const ok = await sendRealDeviceNotification({
      title: 'مینادنتال — یادآوری کلینیک',
      body: 'برای مشاهده جزئیات، وارد برنامه شوید.',
      tag: dedupKey,
      urgent: alert.urgency === 'critical',
    });
    if (ok) {
      sent[dedupKey] = new Date().toISOString();
      if (ledger[dedupKey]) {
        ledger[dedupKey].osDispatched = true;
      }
      dispatched++;
    }
  }

  if (dispatched > 0) {
    saveSentTags(sent);
    saveZeroLossLedger(ledger);
  }
  return dispatched;
}
