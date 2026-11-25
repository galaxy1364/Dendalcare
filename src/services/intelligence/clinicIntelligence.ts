import type { ClinicUserRole } from '@/lib/cloudSyncEngine';
import type { LiveSmartAlert } from '@/lib/smartReminderEngine';
import type { AppRouteId } from '@/lib/navigationStack';
import { canAccessRoute } from '@/services/permissions/accessControl';

export interface SmartBriefDestination {
  section: AppRouteId;
  recordId?: string;
  subTab?: string;
  filters?: Record<string, string>;
}

export interface SmartBriefItem {
  id: string;
  title: string;
  reason: string;
  priority: 'critical' | 'high' | 'normal';
  dueDate: string;
  source: string;
  destination: SmartBriefDestination;
}

export interface SmartDailyBriefSummary {
  headline: string;
  reason: string;
  priority: 'critical' | 'high' | 'normal';
  dueDate: string;
  source: string;
  destination: SmartBriefDestination;
  actionCount: number;
  items: SmartBriefItem[];
}

const DOMAIN_SOURCE_LABELS: Record<LiveSmartAlert['domain'], string> = {
  check: 'چک‌های صیادی',
  safteh: 'سفته و ضمانت',
  installment: 'اقساط بیماران',
  debt: 'مطالبات باز',
  implant: 'پروتکل ایمپلنت',
  lab: 'سفارشات لابراتوار',
  appointment: 'نوبت‌دهی مطب',
  inventory: 'انبار مصرفی',
  treatment: 'پرونده درمان',
};

function mapDomainDestination(alert: LiveSmartAlert): SmartBriefDestination {
  switch (alert.domain) {
    case 'check':
      return { section: 'finance', recordId: alert.stageEntityId, subTab: 'checks' };
    case 'safteh':
      return { section: 'finance', recordId: alert.stageEntityId, subTab: 'safteh' };
    case 'installment':
      return { section: 'finance', recordId: alert.stageEntityId, subTab: 'installments' };
    case 'debt':
      return { section: 'finance', recordId: alert.patientId || undefined, subTab: 'debtors' };
    case 'implant':
      return { section: 'implants', recordId: alert.stageEntityId };
    case 'lab':
      return { section: 'lab', recordId: alert.stageEntityId };
    case 'inventory':
      return { section: 'inventory', recordId: alert.stageEntityId };
    case 'appointment':
      return { section: 'appointments', recordId: alert.stageEntityId, filters: { date: alert.dueDate } };
    case 'treatment':
    default:
      return { section: 'treatments', recordId: alert.stageEntityId };
  }
}

/**
 * Strips patient identifying info before passing aggregate clinic state to any AI / LLM context.
 */
export function sanitizeClinicContextForAI(params: {
  todayApptsCount: number;
  confirmedApptsCount: number;
  activeTreatmentsCount: number;
  overdueAlertsCount: number;
  lowStockCount: number;
  pendingLabCount: number;
}): Record<string, number> {
  return {
    todayApptsCount: Math.max(0, Math.round(params.todayApptsCount)),
    confirmedApptsCount: Math.max(0, Math.round(params.confirmedApptsCount)),
    activeTreatmentsCount: Math.max(0, Math.round(params.activeTreatmentsCount)),
    overdueAlertsCount: Math.max(0, Math.round(params.overdueAlertsCount)),
    lowStockCount: Math.max(0, Math.round(params.lowStockCount)),
    pendingLabCount: Math.max(0, Math.round(params.pendingLabCount)),
  };
}

/**
 * Phase 08: Builds an explainable, read-only, role-aware Smart Daily Brief.
 * - Never fabricates clinical or financial numbers.
 * - Every suggestion carries reason, priority, dueDate, source, and exact destination route.
 */
export function buildSmartDailyBrief(params: {
  alerts: LiveSmartAlert[];
  todayDate: string;
  todayApptsCount: number;
  confirmedApptsCount: number;
  pendingLabCount: number;
  lowStockCount: number;
  userRole: ClinicUserRole;
  hasSufficientData: boolean;
}): SmartDailyBriefSummary {
  const { alerts, todayDate, todayApptsCount, confirmedApptsCount, userRole, hasSufficientData } = params;

  const accessibleAlerts = alerts.filter((a) => canAccessRoute(userRole, a.targetSection));

  const items: SmartBriefItem[] = accessibleAlerts.slice(0, 5).map((a) => ({
    id: a.id,
    title: a.title,
    reason: a.subtitle,
    priority: a.urgency === 'critical' ? 'critical' : a.urgency === 'today' ? 'high' : 'normal',
    dueDate: a.dueDate,
    source: DOMAIN_SOURCE_LABELS[a.domain] || 'پایش کلینیک',
    destination: mapDomainDestination(a),
  }));

  if (items.length > 0) {
    const top = items[0];
    return {
      headline: top.title,
      reason: top.reason,
      priority: top.priority,
      dueDate: top.dueDate,
      source: top.source,
      destination: top.destination,
      actionCount: accessibleAlerts.length,
      items,
    };
  }

  if (!hasSufficientData) {
    return {
      headline: 'در حال پایش داده‌های کلینیک',
      reason: 'با ثبت نوبت، بیمار یا تراکنش مالی، اولویت‌های هوشمند روزانه اینجا نمایش داده می‌شوند.',
      priority: 'normal',
      dueDate: todayDate,
      source: 'برنامه نوبت و پذیرش',
      destination: { section: canAccessRoute(userRole, 'appointments') ? 'appointments' : 'patients' },
      actionCount: 0,
      items: [],
    };
  }

  const defaultSection: AppRouteId =
    userRole === 'assistant'
      ? 'inventory'
      : canAccessRoute(userRole, 'appointments')
      ? 'appointments'
      : 'patients';

  return {
    headline:
      todayApptsCount > 0
        ? `${confirmedApptsCount.toLocaleString('fa-IR')} نوبت تاییدشده از ${todayApptsCount.toLocaleString('fa-IR')} نوبت امروز`
        : 'مورد فوری یا معوقه‌ای ثبت نشده است',
    reason:
      todayApptsCount > 0
        ? 'تمامی چک‌ها، اقساط، سفارشات لابراتوار و موجودی انبار در وضعیت عادی هستند.'
        : 'برای امروز نوبت فعالی ثبت نشده است؛ از بخش نوبت‌دهی برنامه روز را تنظیم کنید.',
    priority: 'normal',
    dueDate: todayDate,
    source: 'برنامه نوبت و پذیرش',
    destination: { section: defaultSection, filters: { date: todayDate } },
    actionCount: 0,
    items: [],
  };
}
