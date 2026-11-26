import { useState, useEffect, useRef } from 'react';
import {
  BellRing,
  CheckCircle2,
  Clock,
  Smartphone,
  ChevronRight,
  ChevronLeft,
  ArrowUpLeft,
  Minimize2,
  Maximize2,
  Phone,
  ShieldAlert,
} from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';
import { NOTIFICATION_SURFACE_TOKENS } from '@/lib/designTokens';
import { MascotTooth, type MascotMood } from '@/components/ui/MascotTooth';
import { useFocusTrap } from '@/platform/focusEngine';
import type { SectionId } from '@/lib/sections';

export interface GlobalReminderPopupItem {
  id: string;
  domain: string;
  targetSection: SectionId;
  patientName: string;
  patientPhone?: string | null;
  title: string;
  subtitle: string;
  dueDate: string;
  urgency: 'critical' | 'today' | 'upcoming' | 'normal';
  amount?: number;
}

interface IOSReminderPopupProps {
  items: GlobalReminderPopupItem[];
  hidden?: boolean;
  forceExpandedKey?: number;
  deviceNotifOn: boolean;
  onNavigate: (section: SectionId) => void;
  onAcknowledge: (alertId: string) => void;
  onSnooze: (alertId: string, minutes: number) => void;
  onSendToPhone: (item: GlobalReminderPopupItem) => void;
  onOpenDrawer: () => void;
}

const DOMAIN_META: Record<string, { label: string; color: string; bg: string; border: string; textDark: string }> = {
  check:       { label: 'چک صیادی',       color: '#DC2626', bg: '#FFF1F2', border: '#FDA4AF', textDark: '#881337' },
  safteh:      { label: 'سفته ضمانت',     color: '#D97706', bg: '#FFFBEB', border: '#FCD34D', textDark: '#78350F' },
  installment: { label: 'قسط ماهانه',     color: '#7C3AED', bg: '#F5F3FF', border: '#C4B5FD', textDark: '#4C1D95' },
  debt:        { label: 'بدهی باز مطب',   color: '#EA580C', bg: '#FFF7ED', border: '#FDBA74', textDark: '#7C2D12' },
  implant:     { label: 'مرحله ایمپلنت',  color: '#0891B2', bg: '#ECFEFF', border: '#67E8F9', textDark: '#164E63' },
  lab:         { label: 'سفارش لابراتوار', color: '#DB2777', bg: '#FDF2F8', border: '#F9A8D4', textDark: '#831843' },
  appointment: { label: 'نوبت بیمار',     color: '#059669', bg: '#ECFDF5', border: '#6EE7B7', textDark: '#064E3B' },
  inventory:   { label: 'انبار و متریال', color: '#D97706', bg: '#FFFBEB', border: '#FCD34D', textDark: '#78350F' },
  treatment:   { label: 'پیگیری درمان',   color: '#4F46E5', bg: '#EEF2FF', border: '#A5B4FC', textDark: '#312E81' },
};

/**
 * Authentic iOS 27 Dynamic Island & Live Activity Global Reminder Popup
 *
 * - 100% Opaque Daylight Surface Isolation (Zero background color bleeding)
 * - WCAG 2.1 AAA Typography Contrast (#0F172A on #FFFFFF = 19:1)
 * - Touch/Hand Horizontal Swipe Slide between active reminders + Swipe Up to minimize
 * - QBank elongated slide pagination pills (• ▬▬ • •)
 * - Connects directly to real phone OS Notifications + 1-click Snooze (15m) + Explicit Acknowledgement
 */
export function IOSReminderPopup({
  items,
  hidden = false,
  forceExpandedKey = 0,
  deviceNotifOn,
  onNavigate,
  onAcknowledge,
  onSnooze,
  onSendToPhone,
  onOpenDrawer,
}: IOSReminderPopupProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swipeY, setSwipeY] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const swipeRef = useRef<{ id: number | null; x: number; y: number; moved: boolean }>({
    id: null,
    x: 0,
    y: 0,
    moved: false,
  });

  useEffect(() => {
    if (forceExpandedKey > 0 && items.length > 0) {
      setExpanded(true);
      setCurrentIndex(0);
    }
  }, [forceExpandedKey, items.length]);

  // Auto-expand once per session when critical or today alerts first arrive
  useEffect(() => {
    if (items.length === 0) return;
    const hasUrgent = items.some((i) => i.urgency === 'critical' || i.urgency === 'today');
    if (hasUrgent && typeof window !== 'undefined') {
      const seenSession = sessionStorage.getItem('minadental_ios_popup_auto_opened');
      if (!seenSession) {
        sessionStorage.setItem('minadental_ios_popup_auto_opened', '1');
        setExpanded(true);
      }
    }
  }, [items]);

  const popupDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(popupDialogRef, expanded && !hidden && items.length > 0, {
    onEscape: () => setExpanded(false),
  });

  if (hidden || items.length === 0) return null;

  const safeIndex = Math.min(currentIndex, items.length - 1);
  const current = items[safeIndex];
  if (!current) return null;

  const meta = DOMAIN_META[current.domain] || {
    label: 'یادآوری هوشمند',
    color: '#4F46E5',
    bg: '#EEF2FF',
    border: '#A5B4FC',
    textDark: '#312E81',
  };

  const urgencyTok = NOTIFICATION_SURFACE_TOKENS.urgency[current.urgency] || NOTIFICATION_SURFACE_TOKENS.urgency.normal;
  const isCritical = current.urgency === 'critical';
  const reminderMascotMood: MascotMood =
    current.urgency === 'critical' || current.urgency === 'today'
      ? 'sad'
      : current.urgency === 'upcoming'
      ? 'pro'
      : 'happy';

  const goSlide = (dir: 'next' | 'prev') => {
    if (items.length <= 1) return;
    playTactileFeedback('soft');
    setCurrentIndex((prev) => {
      if (dir === 'next') return prev < items.length - 1 ? prev + 1 : 0;
      return prev > 0 ? prev - 1 : items.length - 1;
    });
  };

  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest('button, a')) return;
    swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    setSwiping(true);
    setSwipeX(0);
    setSwipeY(0);
  };

  const handleCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = swipeRef.current;
    if (st.id !== e.pointerId) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) st.moved = true;

    if (Math.abs(dx) >= Math.abs(dy)) {
      setSwipeX(Math.max(-90, Math.min(90, dx * 0.65)));
      setSwipeY(0);
    } else if (expanded && dy < 0) {
      setSwipeY(Math.max(-65, dy * 0.55));
      setSwipeX(0);
    }
  };

  const handleCardPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = swipeRef.current;
    if (st.id !== e.pointerId) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    swipeRef.current.id = null;
    setSwiping(false);
    setSwipeX(0);
    setSwipeY(0);

    if (expanded && dy < -48 && Math.abs(dy) > Math.abs(dx)) {
      playTactileFeedback('soft');
      setExpanded(false);
      return;
    }

    if (items.length > 1 && Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy)) {
      // In RTL: swiping left advances to next reminder, swiping right goes to previous
      goSlide(dx < 0 ? 'next' : 'prev');
    }
  };

  const visibleDotCount = Math.min(items.length, 5);

  // 1. COMPACT iOS 27 DYNAMIC ISLAND PILL (In-Flow Non-Overlapping Solid White Card + Hand-Swipe Slides)
  if (!expanded) {
    return (
      <div
        className="w-full animate-fade-in touch-pan-y select-none"
        dir="rtl"
        data-testid="ios27_dynamic_island_pill"
        onPointerDown={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onPointerUp={handleCardPointerUp}
        onPointerCancel={handleCardPointerUp}
      >
        <div
          onClick={() => {
            if (swipeRef.current.moved) return;
            playTactileFeedback('tap');
            setExpanded(true);
          }}
          className="flex flex-col gap-1.5 px-3.5 py-2 rounded-2xl bg-white dark:bg-[#11202E] text-slate-900 dark:text-slate-100 cursor-pointer transition-all hover:scale-[1.005] active:scale-[0.985]"
          style={{
            border: `2px solid ${urgencyTok.border}`,
            boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
            transform: `translateX(${swipeX}px)`,
            transition: swiping ? 'none' : 'transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative shrink-0">
                <MascotTooth mood={reminderMascotMood} size={34} framed interactive={false} />
                <span
                  className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center border border-white"
                  style={{ background: urgencyTok.accent }}
                >
                  <BellRing size={8} className="text-white" />
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black whitespace-nowrap" style={{ color: urgencyTok.text }}>
                    {items.length.toLocaleString('fa-IR')} یادآوری فعال
                  </span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-extrabold whitespace-nowrap"
                    style={{
                      background: deviceNotifOn ? '#ECFDF5' : '#EFF6FF',
                      color: deviceNotifOn ? '#065F46' : '#1E40AF',
                      border: `1px solid ${deviceNotifOn ? '#A7F3D0' : '#BFDBFE'}`,
                    }}
                  >
                    {deviceNotifOn ? 'متصل به گوشی' : 'فعال'}
                  </span>
                </div>
                <p className="text-[11px] font-extrabold text-slate-900 dark:text-slate-100 truncate">{current.title}</p>
              </div>
            </div>

            <button
              type="button"
              data-testid="ios_reminder_popup_expand_btn"
              onClick={(e) => {
                e.stopPropagation();
                playTactileFeedback('tap');
                setExpanded(true);
              }}
              className="px-2.5 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-[10px] font-black text-white shrink-0 flex items-center gap-1 shadow-sm"
            >
              <Maximize2 size={11} />
              <span>باز کردن</span>
            </button>
          </div>

          {items.length > 1 && (
            <div className="flex items-center justify-center gap-1 pt-0.5" aria-hidden="true">
              {Array.from({ length: visibleDotCount }).map((_, idx) => {
                const isDotActive = safeIndex % visibleDotCount === idx;
                return (
                  <span
                    key={idx}
                    className="h-1 rounded-full transition-all duration-200"
                    style={{
                      width: isDotActive ? '16px' : '5px',
                      background: isDotActive ? urgencyTok.accent : '#CBD5E1',
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. EXPANDED iOS 27 LIVE ACTIVITY NOTIFICATION POPUP (100% Opaque White Card + Touch Swipe Slides + Protective Scrim)
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[76px] px-3 bg-slate-900/55 backdrop-blur-sm animate-fade-in"
      dir="rtl"
      onClick={() => {
        playTactileFeedback('soft');
        setExpanded(false);
      }}
    >
      <div
        ref={popupDialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="یادآوری هوشمند مینادنتال"
        className="w-full max-w-md animate-scale-in touch-pan-y select-none"
        data-testid="ios27_expanded_reminder_popup"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onPointerUp={handleCardPointerUp}
        onPointerCancel={handleCardPointerUp}
      >
        <div
          className="rounded-[28px] bg-white dark:bg-[#11202E] text-slate-900 dark:text-slate-100 overflow-hidden relative"
          style={{
            border: `2px solid ${urgencyTok.border}`,
            boxShadow: '0 24px 60px rgba(15, 23, 42, 0.24), 0 4px 12px rgba(15, 23, 42, 0.08)',
            transform: `translate(${swipeX}px, ${swipeY}px)`,
            transition: swiping ? 'none' : 'transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {/* Top Semantic Urgency Accent Strip */}
          <div className="h-1.5 w-full" style={{ background: urgencyTok.accent }} />

          {/* Header Bar */}
          <div className="px-4 pt-3 pb-2.5 bg-[#F8FAFC] dark:bg-[#0D1B2A] border-b border-slate-200 dark:border-[#25394D] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <MascotTooth mood={reminderMascotMood} size={40} framed interactive={false} />
                <span
                  className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center border border-white shadow-xs"
                  style={{ background: urgencyTok.accent }}
                >
                  {isCritical ? (
                    <ShieldAlert size={10} className="text-white" />
                  ) : (
                    <BellRing size={10} className="text-white" />
                  )}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-slate-900 dark:text-slate-100 truncate">
                    یادآوری مطب
                  </span>
                  <span
                    className="text-[9.5px] font-black px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: meta.bg,
                      color: meta.textDark,
                      border: `1px solid ${meta.border}`,
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-[10px] font-semibold text-slate-600 truncate">
                  {deviceNotifOn
                    ? 'متصل به نوتیفیکیشن گوشی'
                    : 'چپ و راست بکشید برای یادآوری بعدی'}
                </p>
              </div>
            </div>

            {/* Queue Pager + Minimize */}
            <div className="flex items-center gap-1 shrink-0">
              {items.length > 1 && (
                <div className="flex items-center gap-0.5 bg-white rounded-full px-1.5 py-0.5 border border-slate-200 shadow-sm">
                  <button
                    type="button"
                    aria-label="یادآوری قبلی"
                    onClick={() => goSlide('prev')}
                    className="p-0.5 text-slate-600 hover:text-slate-900"
                  >
                    <ChevronRight size={13} />
                  </button>
                  <span className="text-[10px] font-black text-indigo-700 px-1 tabular-nums">
                    {(safeIndex + 1).toLocaleString('fa-IR')}/{items.length.toLocaleString('fa-IR')}
                  </span>
                  <button
                    type="button"
                    aria-label="یادآوری بعدی"
                    onClick={() => goSlide('next')}
                    className="p-0.5 text-slate-600 hover:text-slate-900"
                  >
                    <ChevronLeft size={13} />
                  </button>
                </div>
              )}

              <button
                type="button"
                data-testid="ios_reminder_popup_minimize_btn"
                onClick={() => {
                  playTactileFeedback('soft');
                  setExpanded(false);
                }}
                title="کوچک‌سازی به کپسول بالای صفحه (بدون از دست رفتن)"
                className="w-7 h-7 rounded-full bg-white hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 transition-all"
              >
                <Minimize2 size={13} />
              </button>
            </div>
          </div>

          {/* Alert Body (100% High-Contrast Solid Surface) */}
          <div className="p-3.5 space-y-2.5 bg-white">
            <div
              className="rounded-2xl p-3 space-y-1.5"
              style={{
                background: urgencyTok.bg,
                border: `1.5px solid ${urgencyTok.border}`,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-black text-slate-900 leading-snug">{current.title}</h4>
                {current.amount && current.amount > 0 ? (
                  <span className="text-[10.5px] font-black px-2 py-0.5 rounded-lg bg-white text-emerald-800 border border-emerald-200 shrink-0 tabular-nums">
                    {current.amount.toLocaleString('fa-IR')} تومان
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] font-semibold text-slate-700 leading-relaxed">{current.subtitle}</p>
              {current.patientPhone && (
                <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[10px]">
                  <span className="font-bold text-slate-700">مراجعه‌کننده: {current.patientName}</span>
                  <a
                    href={`tel:${current.patientPhone}`}
                    className="inline-flex items-center gap-1 font-mono font-extrabold text-indigo-700 hover:underline"
                    dir="ltr"
                  >
                    <Phone size={11} />
                    {current.patientPhone}
                  </a>
                </div>
              )}
            </div>

            {/* Interactive QBank Slide Pagination Dots (• ▬▬ • •) */}
            {items.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 py-0.5" data-testid="ios_reminder_slide_dots">
                {Array.from({ length: visibleDotCount }).map((_, idx) => {
                  const isDotActive = safeIndex % visibleDotCount === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      aria-label={`اسلاید ${(idx + 1).toLocaleString('fa-IR')}`}
                      onClick={() => {
                        playTactileFeedback('soft');
                        setCurrentIndex(idx);
                      }}
                      className="h-1.5 rounded-full transition-all duration-200"
                      style={{
                        width: isDotActive ? '22px' : '6px',
                        background: isDotActive ? urgencyTok.accent : '#CBD5E1',
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* 4 Instant iOS 27 Action Buttons (Clean Primary + Tonal Secondary Hierarchy) */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="ios_reminder_popup_action_btn"
                onClick={() => {
                  playTactileFeedback('tap');
                  setExpanded(false);
                  onNavigate(current.targetSection);
                }}
                className="py-2 px-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all"
              >
                <ArrowUpLeft size={14} />
                <span>ورود به بخش و اقدام</span>
              </button>

              <button
                type="button"
                data-testid="ios_reminder_popup_ack_btn"
                onClick={() => {
                  playTactileFeedback('success');
                  onAcknowledge(current.id);
                }}
                className="py-2 px-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all"
              >
                <CheckCircle2 size={14} />
                <span>تایید و انجام شد</span>
              </button>

              <button
                type="button"
                data-testid="ios_reminder_popup_snooze_btn"
                onClick={() => {
                  playTactileFeedback('soft');
                  onSnooze(current.id, 15);
                }}
                className="py-2 px-2.5 rounded-2xl bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 text-slate-800 text-[10.5px] font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-all"
              >
                <Clock size={13} className="text-amber-600" />
                <span>یادآوری مجدد (۱۵ دقیقه)</span>
              </button>

              <button
                type="button"
                data-testid="ios_reminder_popup_phone_btn"
                onClick={() => {
                  playTactileFeedback('tap');
                  onSendToPhone(current);
                }}
                className="py-2 px-2.5 rounded-2xl bg-slate-50 hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-slate-800 text-[10.5px] font-extrabold flex items-center justify-center gap-1 active:scale-95 transition-all"
              >
                <Smartphone size={13} className="text-sky-600" />
                <span>ارسال به نوتیف گوشی</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                playTactileFeedback('soft');
                setExpanded(false);
                onOpenDrawer();
              }}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-[10.5px] font-extrabold transition-all text-center"
            >
              مشاهده همه یادآوری‌ها ({items.length.toLocaleString('fa-IR')})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

