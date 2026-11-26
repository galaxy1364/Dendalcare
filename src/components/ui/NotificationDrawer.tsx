import { useState, useRef, useMemo } from 'react';
import {
  BellRing,
  X,
  Smartphone,
  CheckCircle2,
  Clock,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';
import { toJalaliStr } from '@/lib/jalali';
import { MascotTooth, type MascotMood } from '@/components/ui/MascotTooth';
import { useFocusTrap } from '@/platform/focusEngine';
import type { SectionId } from '@/lib/sections';
import type { GlobalReminderPopupItem } from '@/components/ui/IOSReminderPopup';
import type { Message } from '@/lib/supabase';

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  notifCount: number;
  deviceNotifOn: boolean;
  deviceNotifPerm: string;
  onToggleDeviceNotif: (next: boolean) => void;
  onRequestDeviceNotif: () => Promise<void>;
  onTestDeviceNotif: () => Promise<void>;
  spotlightQueue: GlobalReminderPopupItem[];
  alerts: GlobalReminderPopupItem[];
  unreadMessages: Message[];
  totalAlertsCount: number;
  onNavigate: (section: SectionId) => void;
  onAcknowledge: (alertId: string) => void;
  onSnooze: (alertId: string, minutes: number) => void;
  onResetQueue: () => void;
  onOpenIOSPopup: () => void;
}

type DrawerTab = 'all' | 'finance' | 'clinical' | 'ops';

const DOMAIN_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  check:       { label: 'چک صیادی',      color: '#DC2626', bg: '#FEE2E2' },
  safteh:      { label: 'سفته ضمانت',    color: '#D97706', bg: '#FEF3C7' },
  installment: { label: 'قسط ماهانه',    color: '#7C3AED', bg: '#EDE9FE' },
  debt:        { label: 'بدهی مطب',      color: '#EA580C', bg: '#FFEDD5' },
  implant:     { label: 'ایمپلنت',       color: '#0891B2', bg: '#CFFAFE' },
  lab:         { label: 'لابراتوار',     color: '#DB2777', bg: '#FCE7F3' },
  appointment: { label: 'نوبت',          color: '#059669', bg: '#D1FAE5' },
  inventory:   { label: 'انبار',         color: '#D97706', bg: '#FEF3C7' },
  treatment:   { label: 'درمان',         color: '#4F46E5', bg: '#E0E7FF' },
};

/**
 * Individual iOS 27 Gesture Swipe-to-Act Alert Row
 * - Swipe Left -> Reveals Emerald Green "تایید" action tray
 * - Swipe Right -> Reveals Warm Amber "۱۵ دقیقه بعد" action tray
 * - Tap -> Navigates cleanly to the target module & closes drawer
 */
function SwipeableAlertRow({
  alert,
  onNavigate,
  onAcknowledge,
  onSnooze,
}: {
  alert: GlobalReminderPopupItem;
  onNavigate: (sec: SectionId) => void;
  onAcknowledge: (id: string) => void;
  onSnooze: (id: string, mins: number) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gestureRef = useRef<{ id: number | null; x: number; y: number; moved: boolean }>({
    id: null,
    x: 0,
    y: 0,
    moved: false,
  });

  const isCritical = alert.urgency === 'critical';
  const isToday = alert.urgency === 'today';
  const accentColor = isCritical ? '#E11D48' : isToday ? '#D97706' : '#2563EB';
  const badge = DOMAIN_BADGE[alert.domain] || { label: 'یادآوری', color: '#4F46E5', bg: '#EEF2FF' };

  const showAckTray = dragX < -10;
  const showSnoozeTray = dragX > 10;

  return (
    <div
      data-no-drawer-drag="true"
      data-testid={`swipeable_alert_row_${alert.id}`}
      className="relative rounded-[20px] overflow-hidden select-none"
    >
      {/* Revealed Left-Swipe Action Tray (Acknowledge / تایید) */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-end px-4 transition-opacity duration-150 ${
          showAckTray ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: '#059669' }}
      >
        <div className="flex items-center gap-1.5 text-white font-black text-xs">
          <CheckCircle2 size={17} />
          <span>تایید و انجام شد</span>
        </div>
      </div>

      {/* Revealed Right-Swipe Action Tray (Snooze 15m / تعویق ۱۵ دقیقه) */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center justify-start px-4 transition-opacity duration-150 ${
          showSnoozeTray ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: '#D97706' }}
      >
        <div className="flex items-center gap-1.5 text-white font-black text-xs">
          <Clock size={17} />
          <span>۱۵ دقیقه بعد</span>
        </div>
      </div>

      {/* Foreground Crisp White Notification Card */}
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement)?.closest('button')) return;
          gestureRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const st = gestureRef.current;
          if (st.id !== e.pointerId) return;
          const dx = e.clientX - st.x;
          const dy = e.clientY - st.y;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) st.moved = true;
          if (Math.abs(dx) > Math.abs(dy) * 1.1) {
            setDragX(Math.max(-108, Math.min(108, dx * 0.85)));
          }
        }}
        onPointerUp={(e) => {
          const st = gestureRef.current;
          if (st.id !== e.pointerId) return;
          const dx = e.clientX - st.x;
          const moved = st.moved;
          gestureRef.current.id = null;
          setDragging(false);
          setDragX(0);

          if (dx < -58) {
            playTactileFeedback('success');
            onAcknowledge(alert.id);
          } else if (dx > 58) {
            playTactileFeedback('soft');
            onSnooze(alert.id, 15);
          } else if (!moved) {
            playTactileFeedback('tap');
            onNavigate(alert.targetSection);
          }
        }}
        onPointerCancel={() => {
          gestureRef.current.id = null;
          setDragging(false);
          setDragX(0);
        }}
        className="relative z-10 w-full text-right rounded-[20px] bg-white dark:bg-[#11202E] border border-slate-200/95 dark:border-[#25394D] p-3 shadow-sm cursor-pointer touch-pan-y"
        style={{
          borderRightWidth: '4px',
          borderRightColor: accentColor,
          transform: `translateX(${dragX}px)`,
          transition: dragging ? 'none' : 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="text-[9.5px] font-black px-2 py-0.5 rounded-full shrink-0"
              style={{ background: badge.bg, color: badge.color }}
            >
              {badge.label}
            </span>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">
              {alert.patientName}
            </span>
          </div>
          <span className="text-[10px] font-extrabold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
            {toJalaliStr(alert.dueDate)}
          </span>
        </div>

        <p className="text-xs font-black text-slate-900 dark:text-slate-100 leading-snug line-clamp-1">
          {alert.title}
        </p>

        <div className="flex items-center justify-between gap-2 mt-1">
          <p className="text-[10.5px] font-medium text-slate-600 dark:text-slate-300 line-clamp-1 flex-1">
            {alert.subtitle}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="تعویق ۱۵ دقیقه"
              onClick={(e) => {
                e.stopPropagation();
                playTactileFeedback('soft');
                onSnooze(alert.id, 15);
              }}
              className="w-7 h-7 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-slate-700 dark:text-slate-200 hover:text-amber-800 dark:hover:text-amber-300 flex items-center justify-center transition-colors"
            >
              <Clock size={12} />
            </button>
            <button
              type="button"
              aria-label="تایید و انجام"
              onClick={(e) => {
                e.stopPropagation();
                playTactileFeedback('success');
                onAcknowledge(alert.id);
              }}
              className="w-7 h-7 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-600 text-emerald-700 dark:text-emerald-300 hover:text-white border border-emerald-200 dark:border-emerald-800 flex items-center justify-center transition-colors"
            >
              <CheckCircle2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Modern iOS 27 + QBank Slide-Over Notification Center
 *
 * - Fluid right-edge swipe-to-dismiss gesture on drawer
 * - Interactive stacked swipe deck at top with physical rotation/follow & pagination pills
 * - Smart grouping ("فوری و امروز" vs "پیش‌رو")
 * - Real iOS horizontal swipe-to-acknowledge / swipe-to-snooze action trays on every alert card
 */
export function NotificationDrawer({
  open,
  onClose,
  notifCount,
  deviceNotifOn,
  deviceNotifPerm,
  onToggleDeviceNotif,
  onRequestDeviceNotif,
  onTestDeviceNotif,
  spotlightQueue,
  alerts,
  unreadMessages,
  totalAlertsCount,
  onNavigate,
  onAcknowledge,
  onSnooze,
  onResetQueue,
  onOpenIOSPopup,
}: NotificationDrawerProps) {
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('all');
  const [drawerDragX, setDrawerDragX] = useState(0);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [deckDragX, setDeckDragX] = useState(0);
  const [deckDragging, setDeckDragging] = useState(false);

  const drawerSwipeRef = useRef<{ id: number | null; x: number; y: number }>({ id: null, x: 0, y: 0 });
  const deckSwipeRef = useRef<{ id: number | null; x: number; moved: boolean }>({ id: null, x: 0, moved: false });
  const drawerPanelRef = useRef<HTMLElement>(null);

  useFocusTrap(drawerPanelRef, open, { onEscape: onClose });

  const filteredAlerts = useMemo(() => {
    if (drawerTab === 'finance') {
      return alerts.filter(a => a.domain === 'check' || a.domain === 'safteh' || a.domain === 'installment' || a.domain === 'debt');
    }
    if (drawerTab === 'clinical') {
      return alerts.filter(a => a.domain === 'implant' || a.domain === 'lab');
    }
    if (drawerTab === 'ops') {
      return alerts.filter(a => a.domain === 'appointment' || a.domain === 'inventory');
    }
    return alerts;
  }, [alerts, drawerTab]);

  const urgentGroup = useMemo(
    () => filteredAlerts.filter(a => a.urgency === 'critical' || a.urgency === 'today'),
    [filteredAlerts]
  );
  const upcomingGroup = useMemo(
    () => filteredAlerts.filter(a => a.urgency !== 'critical' && a.urgency !== 'today'),
    [filteredAlerts]
  );

  if (!open) return null;

  const safeSlide = spotlightQueue.length > 0 ? slideIdx % spotlightQueue.length : 0;
  const activeSlide = spotlightQueue[safeSlide];
  const dotsCount = Math.min(spotlightQueue.length, 5);
  const drawerMascotMood: MascotMood =
    urgentGroup.length > 0 ? 'sad' : notifCount > 0 ? 'pro' : 'celebrate';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-start"
      onClick={() => {
        playTactileFeedback('soft');
        onClose();
      }}
      data-testid="slide_over_notification_drawer"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md animate-fade-in" />

      <aside
        ref={drawerPanelRef}
        role="dialog"
        aria-modal="true"
        aria-label="مرکز اعلان‌ها و یادآوری‌ها"
        className="relative w-full max-w-sm h-full bg-[#F4F7F9] dark:bg-[#0A141E] text-[#14283B] dark:text-[#F1F5F9] border-l border-[#D8E2EA] dark:border-[#25394D] rounded-l-[30px] flex flex-col drawer-slide-in-right safe-top safe-bottom overflow-hidden"
        onClick={e => e.stopPropagation()}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement)?.closest('button, a, [data-no-drawer-drag="true"]')) return;
          drawerSwipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          setDrawerDragging(true);
        }}
        onPointerMove={(e) => {
          const st = drawerSwipeRef.current;
          if (st.id !== e.pointerId) return;
          const dx = e.clientX - st.x;
          const dy = e.clientY - st.y;
          if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
            setDrawerDragX(Math.min(280, dx));
          }
        }}
        onPointerUp={(e) => {
          const st = drawerSwipeRef.current;
          if (st.id !== e.pointerId) return;
          const dx = e.clientX - st.x;
          st.id = null;
          setDrawerDragging(false);
          setDrawerDragX(0);
          if (dx > 68) {
            playTactileFeedback('soft');
            onClose();
          }
        }}
        onPointerCancel={() => {
          drawerSwipeRef.current.id = null;
          setDrawerDragging(false);
          setDrawerDragX(0);
        }}
        style={{
          boxShadow: '-18px 0 50px rgba(15, 23, 42, 0.25)',
          transform: `translateX(${drawerDragX}px)`,
          transition: drawerDragging ? 'none' : 'transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Clean Modern Header */}
        <div className="px-4 pt-3.5 pb-3 bg-white dark:bg-[#11202E] border-b border-slate-200/90 dark:border-[#25394D] shrink-0 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <MascotTooth mood={drawerMascotMood} size={48} interactive={false} />
                <span
                  className={`absolute -bottom-0.5 -left-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white border border-white ${
                    urgentGroup.length > 0 ? 'bg-rose-600' : 'bg-indigo-600'
                  }`}
                >
                  <BellRing size={9} className="bell-swing" />
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 truncate">اعلان‌ها و یادآوری‌ها</h3>
                  <span className="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-black tabular-nums">
                    {notifCount.toLocaleString('fa-IR')}
                  </span>
                </div>
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  سوایپ چپ: تایید • سوایپ راست: تعویق
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                playTactileFeedback('soft');
                onClose();
              }}
              aria-label="بستن"
              className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 shrink-0 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Slim Compact OS Notification + Popup Bar */}
          <div className="flex items-center gap-1.5">
            <div
              className={`flex-1 flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl border text-[10px] font-extrabold ${
                deviceNotifOn
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-1 truncate">
                <Smartphone size={13} className={deviceNotifOn ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'} />
                {deviceNotifPerm === 'denied'
                  ? 'اعلان مرورگر مسدود است'
                  : deviceNotifOn
                  ? 'اعلان گوشی روشن'
                  : 'اعلان گوشی خاموش'}
              </span>
              {deviceNotifOn ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    data-testid="test_real_device_notif_btn"
                    onClick={onTestDeviceNotif}
                    className="px-2 py-0.5 rounded-lg bg-emerald-600 text-white font-black"
                  >
                    تست
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleDeviceNotif(false)}
                    className="px-1.5 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                  >
                    خاموش
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="enable_real_device_notif_btn"
                  onClick={onRequestDeviceNotif}
                  className="px-2 py-0.5 rounded-lg bg-emerald-600 text-white font-black shrink-0"
                >
                  روشن کردن
                </button>
              )}
            </div>

            <button
              type="button"
              data-testid="trigger_ios_reminder_popup_btn"
              onClick={onOpenIOSPopup}
              title="نمایش پنجره یادآور روی صفحه"
              className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black flex items-center gap-1 shrink-0 shadow-sm"
            >
              <Sparkles size={12} />
              <span>پاپ‌آپ</span>
            </button>

            <button
              type="button"
              data-testid="reset_acknowledged_reminders_btn"
              onClick={onResetQueue}
              title="بازگردانی همه یادآوری‌ها"
              className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 shrink-0"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
          {/* Interactive Stacked Touch-Swipe Deck (کارت اسلایدی فوری با ژست دست) */}
          {activeSlide && (
            <div className="relative pt-1 pb-2" data-no-drawer-drag="true">
              {/* Background stacked depth card */}
              {spotlightQueue.length > 1 && (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-3 top-2.5 bottom-0 rounded-[22px] bg-[#E9EEF5] dark:bg-[#162738] border border-slate-200 dark:border-[#25394D] shadow-sm pointer-events-none"
                />
              )}

              <div
                data-testid="drawer_notification_slide_carousel"
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement)?.closest('button')) return;
                  deckSwipeRef.current = { id: e.pointerId, x: e.clientX, moved: false };
                  setDeckDragging(true);
                }}
                onPointerMove={(e) => {
                  const st = deckSwipeRef.current;
                  if (st.id !== e.pointerId) return;
                  const dx = e.clientX - st.x;
                  if (Math.abs(dx) > 6) st.moved = true;
                  setDeckDragX(Math.max(-96, Math.min(96, dx * 0.75)));
                }}
                onPointerUp={(e) => {
                  const st = deckSwipeRef.current;
                  if (st.id !== e.pointerId) return;
                  const dx = e.clientX - st.x;
                  st.id = null;
                  setDeckDragging(false);
                  setDeckDragX(0);
                  if (spotlightQueue.length > 1 && Math.abs(dx) > 36) {
                    playTactileFeedback('soft');
                    setSlideIdx(prev =>
                      dx < 0
                        ? (prev + 1) % spotlightQueue.length
                        : (prev - 1 + spotlightQueue.length) % spotlightQueue.length
                    );
                  } else if (!st.moved) {
                    playTactileFeedback('tap');
                    onNavigate(activeSlide.targetSection);
                    onClose();
                  }
                }}
                onPointerCancel={() => {
                  deckSwipeRef.current.id = null;
                  setDeckDragging(false);
                  setDeckDragX(0);
                }}
                className="relative z-10 rounded-[22px] bg-white dark:bg-[#11202E] border-2 p-3 shadow-md select-none touch-pan-y cursor-grab active:cursor-grabbing"
                style={{
                  borderColor:
                    activeSlide.urgency === 'critical'
                      ? '#FDA4AF'
                      : activeSlide.urgency === 'today'
                      ? '#FCD34D'
                      : '#BFDBFE',
                  transform: `translateX(${deckDragX}px) rotate(${(deckDragX * 0.03).toFixed(2)}deg)`,
                  transition: deckDragging ? 'none' : 'transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-6 h-6 rounded-xl flex items-center justify-center text-white ${
                        activeSlide.urgency === 'critical' ? 'bg-rose-600' : 'bg-amber-600'
                      }`}
                    >
                      {activeSlide.urgency === 'critical' ? <ShieldAlert size={13} /> : <BellRing size={13} />}
                    </span>
                    <span className="text-[10px] font-black text-slate-800 dark:text-slate-200">
                      {(safeSlide + 1).toLocaleString('fa-IR')} از {spotlightQueue.length.toLocaleString('fa-IR')}
                    </span>
                  </div>

                  {spotlightQueue.length > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="اسلاید قبلی"
                        onClick={() => {
                          playTactileFeedback('soft');
                          setSlideIdx(prev => (prev > 0 ? prev - 1 : spotlightQueue.length - 1));
                        }}
                        className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
                      >
                        <ChevronRight size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="اسلاید بعدی"
                        onClick={() => {
                          playTactileFeedback('soft');
                          setSlideIdx(prev => (prev + 1) % spotlightQueue.length);
                        }}
                        className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200"
                      >
                        <ChevronLeft size={13} />
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-xs font-black text-slate-900 dark:text-slate-100 leading-snug">{activeSlide.title}</p>
                <p className="text-[10.5px] font-semibold text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">{activeSlide.subtitle}</p>

                <div className="flex items-center justify-between gap-2 mt-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        playTactileFeedback('success');
                        onAcknowledge(activeSlide.id);
                      }}
                      className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black shadow-sm"
                    >
                      انجام شد
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playTactileFeedback('soft');
                        onSnooze(activeSlide.id, 15);
                      }}
                      className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-slate-800 dark:text-slate-200 text-[10px] font-extrabold"
                    >
                      ۱۵ دقیقه بعد
                    </button>
                  </div>

                  {spotlightQueue.length > 1 && (
                    <div className="flex items-center gap-1">
                      {Array.from({ length: dotsCount }).map((_, idx) => {
                        const act = safeSlide % dotsCount === idx;
                        return (
                          <button
                            key={idx}
                            type="button"
                            aria-label={`اسلاید ${(idx + 1).toLocaleString('fa-IR')}`}
                            onClick={() => {
                              playTactileFeedback('soft');
                              setSlideIdx(idx);
                            }}
                            className="h-1.5 rounded-full transition-all duration-200"
                            style={{
                              width: act ? '16px' : '5px',
                              background: act ? '#E11D48' : '#CBD5E1',
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Segmented Category Pill Filter */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-slate-200/70 dark:bg-slate-800/80 overflow-x-auto no-scrollbar">
            {[
              { id: 'all' as const, label: 'همه', count: alerts.length },
              {
                id: 'finance' as const,
                label: 'مالی و چک',
                count: alerts.filter(a => a.domain === 'check' || a.domain === 'safteh' || a.domain === 'installment' || a.domain === 'debt').length,
              },
              {
                id: 'clinical' as const,
                label: 'ایمپلنت و لاب',
                count: alerts.filter(a => a.domain === 'implant' || a.domain === 'lab').length,
              },
              {
                id: 'ops' as const,
                label: 'نوبت و انبار',
                count: alerts.filter(a => a.domain === 'appointment' || a.domain === 'inventory').length,
              },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  playTactileFeedback('tap');
                  setDrawerTab(tab.id);
                }}
                className={`flex-1 px-2 py-1.5 rounded-xl text-[10.5px] font-extrabold whitespace-nowrap transition-all ${
                  drawerTab === tab.id
                    ? 'bg-white dark:bg-[#11202E] text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label} ({tab.count.toLocaleString('fa-IR')})
              </button>
            ))}
          </div>

          {/* Smart Grouped Swipeable Notification Cards */}
          {filteredAlerts.length === 0 && unreadMessages.length === 0 ? (
            <div className="flex flex-col items-center text-center py-9 px-4 bg-white dark:bg-[#11202E] rounded-2xl border border-slate-200 dark:border-[#25394D]">
              <MascotTooth mood="celebrating" size={56} interactive={false} className="mb-3" />
              <p className="text-sm text-slate-900 dark:text-slate-100 font-black">همه یادآوری‌ها بررسی شده‌اند</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">مورد فوری فعالی وجود ندارد — عالی پیش رفتید!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {urgentGroup.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10.5px] font-black text-rose-700 dark:text-rose-400 px-1">
                    فوری و امروز ({urgentGroup.length.toLocaleString('fa-IR')})
                  </p>
                  {urgentGroup.map(alert => (
                    <SwipeableAlertRow
                      key={alert.id}
                      alert={alert}
                      onNavigate={(sec) => {
                        onNavigate(sec);
                        onClose();
                      }}
                      onAcknowledge={onAcknowledge}
                      onSnooze={onSnooze}
                    />
                  ))}
                </div>
              )}

              {upcomingGroup.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10.5px] font-black text-slate-600 dark:text-slate-300 px-1">
                    برنامه پیش‌رو ({upcomingGroup.length.toLocaleString('fa-IR')})
                  </p>
                  {upcomingGroup.map(alert => (
                    <SwipeableAlertRow
                      key={alert.id}
                      alert={alert}
                      onNavigate={(sec) => {
                        onNavigate(sec);
                        onClose();
                      }}
                      onAcknowledge={onAcknowledge}
                      onSnooze={onSnooze}
                    />
                  ))}
                </div>
              )}

              {unreadMessages.slice(0, 5).map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onNavigate('messages');
                    onClose();
                  }}
                  className="w-full text-right rounded-[20px] bg-white dark:bg-[#11202E] hover:bg-sky-50 dark:hover:bg-[#162738] border border-sky-200 dark:border-sky-800/70 p-3 shadow-sm transition-all"
                  style={{ borderRightWidth: '4px', borderRightColor: '#0284C7' }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-sky-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-slate-900 dark:text-slate-100 truncate">پیام جدید: {m.subject}</p>
                      <p className="text-[10.5px] font-semibold text-slate-600 dark:text-slate-300 truncate">{m.body?.slice(0, 50)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div className="p-3 bg-white dark:bg-[#11202E] border-t border-slate-200 dark:border-[#25394D] shrink-0">
          <button
            type="button"
            onClick={() => {
              onNavigate('reminders');
              onClose();
            }}
            className="w-full py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
          >
            <BellRing size={15} />
            <span>مدیریت کامل یادآوری‌ها ({totalAlertsCount.toLocaleString('fa-IR')})</span>
            <ArrowLeft size={14} />
          </button>
        </div>
      </aside>
    </div>
  );
}
