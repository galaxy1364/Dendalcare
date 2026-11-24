import { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';

const HANDLE_Y_STORAGE_KEY = 'minadental_right_bell_y_pct';

function loadSavedYPct(): number {
  if (typeof window === 'undefined') return 58;
  try {
    const raw = localStorage.getItem(HANDLE_Y_STORAGE_KEY);
    if (!raw) return 58;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return 58;
    return Math.min(78, Math.max(16, parsed));
  } catch {
    return 58;
  }
}

interface Props {
  notifCount: number;
  open: boolean;
  onOpen: () => void;
}

/**
 * QBank / iOS Right-Edge Draggable Curved Notification Handle
 * Trace ID: TRC-MINA-QBANK-9008-H
 *
 * - Mounted on the right border with QBank's signature smooth curved ear silhouette
 * - Vertically draggable with one hand via Pointer Capture
 * - Locks permanently wherever released (persisted in localStorage, never drifts)
 * - Tap or swipe left opens the right-side iOS slide-over Notification Drawer
 */
export function DraggableNotificationHandle({ notifCount, open, onOpen }: Props) {
  const [yPct, setYPct] = useState<number>(() => loadSavedYPct());
  const [dragging, setDragging] = useState(false);

  const dragStateRef = useRef<{
    pointerId: number | null;
    startY: number;
    startX: number;
    startPct: number;
    moved: boolean;
  }>({
    pointerId: null,
    startY: 0,
    startX: 0,
    startPct: 58,
    moved: false,
  });

  if (open) return null;

  const clampPct = (val: number) => Math.min(78, Math.max(16, val));

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startX: e.clientX,
      startPct: yPct,
      moved: false,
    };
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (st.pointerId !== e.pointerId) return;

    const dy = e.clientY - st.startY;
    const dx = e.clientX - st.startX;

    if (Math.abs(dy) > 6 || Math.abs(dx) > 6) {
      st.moved = true;
    }

    // Swipe left from the right edge opens drawer smoothly
    if (dx < -34 && Math.abs(dy) < 28) {
      st.pointerId = null;
      setDragging(false);
      playTactileFeedback('drawer');
      onOpen();
      return;
    }

    if (Math.abs(dy) > 4 && typeof window !== 'undefined' && window.innerHeight > 0) {
      const deltaPct = (dy / window.innerHeight) * 100;
      const next = clampPct(st.startPct + deltaPct);
      setYPct(next);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (st.pointerId !== e.pointerId) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    st.pointerId = null;
    setDragging(false);

    if (!st.moved) {
      playTactileFeedback('drawer');
      onOpen();
    } else {
      // Persist exact dropped position permanently
      playTactileFeedback('soft');
      try {
        localStorage.setItem(HANDLE_Y_STORAGE_KEY, yPct.toFixed(2));
      } catch {
        // ignore
      }
    }
  };

  return (
    <button
      type="button"
      data-testid="right_edge_draggable_bell_handle"
      aria-label="اعلان‌ها و یادآوری‌های هوشمند (قابل جابجایی عمودی)"
      title="لمس برای باز کردن یادآوری‌ها • کشیدن بالا/پایین برای جابجایی دائمی"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="fixed right-0 md:right-20 lg:right-64 z-40 touch-none select-none flex items-center justify-center focus:outline-none"
      style={{
        top: `${yPct}%`,
        transform: `translateY(-50%) scale(${dragging ? 1.06 : 1})`,
        width: '44px',
        height: '84px',
        transition: dragging ? 'transform 0.12s ease' : 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* QBank Smooth Curved Right-Edge Ear Silhouette (100% Opaque Isolation) */}
      <svg
        viewBox="0 0 44 84"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          filter: dragging
            ? 'drop-shadow(-4px 6px 16px rgba(79, 70, 229, 0.35))'
            : 'drop-shadow(-3px 4px 12px rgba(15, 23, 42, 0.16))',
        }}
      >
        <path
          d="M 44,0 C 44,12 36,14 24,17 C 11,20 4,28 4,42 C 4,56 11,64 24,67 C 36,70 44,72 44,84 Z"
          fill="#FFFFFF"
          stroke="#CBD5E1"
          strokeWidth="1.6"
        />
      </svg>

      {/* Colorful Swinging Bell + Unread Dot */}
      <div className="relative z-10 flex items-center justify-center pl-1">
        <Bell
          size={20}
          strokeWidth={2.4}
          className={notifCount > 0 ? 'text-indigo-700 bell-swing' : 'text-slate-700'}
        />
        {notifCount > 0 && (
          <span
            className="absolute -top-2 -left-2 min-w-[17px] h-[17px] px-1 rounded-full bg-rose-600 text-white text-[9px] font-black flex items-center justify-center border-2 border-white shadow-sm"
            data-testid="right_edge_bell_badge"
          >
            {notifCount > 99 ? '99+' : notifCount.toLocaleString('fa-IR')}
          </span>
        )}
      </div>
    </button>
  );
}
