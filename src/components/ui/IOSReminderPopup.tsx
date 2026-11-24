import { useState, useEffect } from 'react';
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

const DOMAIN_META: Record<string, { label: string; color: string; bg: string }> = {
  check: { label: 'چک صیادی', color: '#E11D48', bg: 'rgba(225,29,72,0.18)' },
  safteh: { label: 'سفته ضمانت', color: '#D97706', bg: 'rgba(217,119,6,0.18)' },
  installment: { label: 'قسط ماهانه', color: '#7C3AED', bg: 'rgba(124,58,237,0.18)' },
  debt: { label: 'بدهی باز مطب', color: '#EA580C', bg: 'rgba(234,88,12,0.18)' },
  implant: { label: 'مرحله ایمپلنت', color: '#06B6D4', bg: 'rgba(6,182,212,0.18)' },
  lab: { label: 'سفارش لابراتوار', color: '#EC4899', bg: 'rgba(236,72,153,0.18)' },
  appointment: { label: 'نوبت بیمار', color: '#10B981', bg: 'rgba(16,185,129,0.18)' },
  inventory: { label: 'انبار و متریال', color: '#F59E0B', bg: 'rgba(245,158,11,0.18)' },
  treatment: { label: 'پیگیری درمان', color: '#6366F1', bg: 'rgba(99,102,241,0.18)' },
};

/**
 * Authentic iOS 27 Dynamic Island & Live Activity Global Reminder Popup
 *
 * - Never loses a single reminder: queues all unacknowledged alerts with a live pager (1 of N).
 * - Dual-mode iOS 27 UX: Compact Dynamic Island Pill or Expanded Frosted Glass Notification Card.
 * - Connects directly to real phone OS Notifications + 1-click Snooze (15m) + Explicit Acknowledgement.
 * - Automatically hides whenever the right-edge notification drawer is open.
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

  if (hidden || items.length === 0) return null;

  const safeIndex = Math.min(currentIndex, items.length - 1);
  const current = items[safeIndex];
  if (!current) return null;

  const meta = DOMAIN_META[current.domain] || {
    label: 'یادآوری هوشمند',
    color: '#8B5CF6',
    bg: 'rgba(139,92,246,0.18)',
  };

  const isCritical = current.urgency === 'critical';

  // 1. COMPACT iOS 27 DYNAMIC ISLAND PILL (Zero-clutter floating capsule below top bar)
  if (!expanded) {
    return (
      <div
        className="fixed top-[68px] left-1/2 -translate-x-1/2 z-40 px-3 w-full max-w-md pointer-events-none animate-fade-in"
        dir="rtl"
        data-testid="ios27_dynamic_island_pill"
      >
        <div
          onClick={() => {
            playTactileFeedback('tap');
            setExpanded(true);
          }}
          className="pointer-events-auto mx-auto flex items-center justify-between gap-2.5 px-3.5 py-2 rounded-full bg-slate-950/92 text-white border border-white/15 shadow-2xl backdrop-blur-2xl cursor-pointer transition-all hover:scale-[1.01] active:scale-95"
          style={{
            boxShadow: '0 10px 30px rgba(15,23,42,0.35), inset 0 1px 0 rgba(255,255,255,0.14)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: isCritical
                  ? 'linear-gradient(135deg, #EF4444, #E11D48)'
                  : 'linear-gradient(135deg, #F59E0B, #EA580C)',
              }}
            >
              <BellRing size={14} className="text-white bell-swing" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black text-amber-300 whitespace-nowrap">
                  {items.length.toLocaleString('fa-IR')} یادآوری در صف ضد فراموشی
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/12 text-emerald-300 font-bold whitespace-nowrap">
                  {deviceNotifOn ? 'متصل به گوشی' : 'داخلی iOS 27'}
                </span>
              </div>
              <p className="text-[11px] font-bold text-white/95 truncate">{current.title}</p>
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
            className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-[10px] font-black text-white shrink-0 flex items-center gap-1"
          >
            <Maximize2 size={11} />
            <span>باز کردن</span>
          </button>
        </div>
      </div>
    );
  }

  // 2. EXPANDED iOS 27 LIVE ACTIVITY / FROSTED NOTIFICATION POPUP CARD
  return (
    <div
      className="fixed top-[68px] left-1/2 -translate-x-1/2 z-40 px-3 w-full max-w-md animate-scale-in"
      dir="rtl"
      data-testid="ios27_expanded_reminder_popup"
    >
      <div
        className="rounded-[28px] bg-slate-950/95 text-white border border-white/18 backdrop-blur-3xl overflow-hidden"
        style={{
          boxShadow: '0 22px 55px rgba(15,23,42,0.52), inset 0 1px 0 rgba(255,255,255,0.18)',
        }}
      >
        {/* Top iOS Dynamic Island Grabber + Queue Pager Header */}
        <div className="px-4 pt-3 pb-2.5 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 shadow-md"
              style={{
                background: isCritical
                  ? 'linear-gradient(135deg, #EF4444, #E11D48)'
                  : 'linear-gradient(135deg, #F59E0B, #D97706)',
              }}
            >
              {isCritical ? (
                <ShieldAlert size={16} className="text-white" />
              ) : (
                <BellRing size={16} className="text-white bell-swing" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black text-white truncate">
                  رادار هوشمند یادآوری (ضد از دست رفتن)
                </span>
                <span
                  className="text-[9.5px] font-black px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: meta.bg, color: '#FDE68A' }}
                >
                  {meta.label}
                </span>
              </div>
              <p className="text-[10px] text-slate-300 truncate">
                {deviceNotifOn
                  ? 'متصل به نوتیفیکیشن واقعی گوشی + پاپ‌آپ داخلی iOS 27'
                  : 'پاپ‌آپ داخلی iOS 27 • هیچ هشداری تا تایید شما حذف نمی‌شود'}
              </p>
            </div>
          </div>

          {/* Queue Pager + Minimize to Dynamic Island Pill */}
          <div className="flex items-center gap-1 shrink-0">
            {items.length > 1 && (
              <div className="flex items-center gap-0.5 bg-white/10 rounded-full px-1.5 py-0.5 border border-white/10">
                <button
                  type="button"
                  aria-label="یادآوری قبلی"
                  onClick={() => {
                    playTactileFeedback('soft');
                    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
                  }}
                  className="p-0.5 text-white/80 hover:text-white"
                >
                  <ChevronRight size={13} />
                </button>
                <span className="text-[10px] font-black text-amber-300 px-1">
                  {(safeIndex + 1).toLocaleString('fa-IR')}/{items.length.toLocaleString('fa-IR')}
                </span>
                <button
                  type="button"
                  aria-label="یادآوری بعدی"
                  onClick={() => {
                    playTactileFeedback('soft');
                    setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
                  }}
                  className="p-0.5 text-white/80 hover:text-white"
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
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-200 transition-all"
            >
              <Minimize2 size={13} />
            </button>
          </div>
        </div>

        {/* Alert Body */}
        <div className="p-3.5 space-y-2.5">
          <div className="rounded-2xl bg-white/8 border border-white/12 p-3 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-xs font-black text-white leading-snug">{current.title}</h4>
              {current.amount && current.amount > 0 ? (
                <span className="text-[10.5px] font-black px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shrink-0">
                  {current.amount.toLocaleString('fa-IR')} تومان
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">{current.subtitle}</p>
            {current.patientPhone && (
              <div className="pt-1 flex items-center justify-between text-[10px] text-cyan-300">
                <span>مراجعه‌کننده: {current.patientName}</span>
                <a
                  href={`tel:${current.patientPhone}`}
                  className="inline-flex items-center gap-1 font-mono font-bold text-cyan-300 hover:underline"
                  dir="ltr"
                >
                  <Phone size={11} />
                  {current.patientPhone}
                </a>
              </div>
            )}
          </div>

          {/* 4 Instant iOS 27 Action Buttons (Zero-Loss Workflow) */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="ios_reminder_popup_action_btn"
              onClick={() => {
                playTactileFeedback('tap');
                setExpanded(false);
                onNavigate(current.targetSection);
              }}
              className="py-2 px-2.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
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
              className="py-2 px-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
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
              className="py-2 px-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/12 text-amber-200 text-[10.5px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-all"
            >
              <Clock size={13} />
              <span>یادآوری مجدد (۱۵ دقیقه)</span>
            </button>

            <button
              type="button"
              data-testid="ios_reminder_popup_phone_btn"
              onClick={() => {
                playTactileFeedback('tap');
                onSendToPhone(current);
              }}
              className="py-2 px-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/12 text-cyan-200 text-[10.5px] font-bold flex items-center justify-center gap-1 active:scale-95 transition-all"
            >
              <Smartphone size={13} />
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
            className="w-full py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300 transition-all text-center"
          >
            مشاهده لیست کامل همه یادآوری‌ها در کشوی کناری ({items.length.toLocaleString('fa-IR')} مورد)
          </button>
        </div>
      </div>
    </div>
  );
}
