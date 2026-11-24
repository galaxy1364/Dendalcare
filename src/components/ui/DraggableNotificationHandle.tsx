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
  const [pullOffsetX, setPullOffsetX] = useState(0);

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
    setPullOffsetX(0);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (st.pointerId !== e.pointerId) return;

    const dy = e.clientY - st.startY;
    const dx = e.clientX - st.startX;

    if (Math.abs(dy) > 6 || Math.abs(dx) > 6) {
      st.moved = true;
    }

    // Live horizontal finger pull feedback from the right edge (Screenshots 3 & 4)
    if (dx < -4 && Math.abs(dx) > Math.abs(dy) * 0.8) {
      setPullOffsetX(Math.max(-24, dx * 0.45));
    }

    // Swipe left with finger opens drawer smoothly
    if (dx < -32 && Math.abs(dy) < 34) {
      st.pointerId = null;
      setDragging(false);
      setPullOffsetX(0);
      playTactileFeedback('drawer');
      onOpen();
      return;
    }

    if (Math.abs(dy) > 5 && Math.abs(dy) >= Math.abs(dx) && typeof window !== 'undefined' && window.innerHeight > 0) {
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
    setPullOffsetX(0);

    if (!st.moved) {
      playTactileFeedback('drawer');
      onOpen();
    } else {
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
      aria-label="اعلان‌ها و یادآوری‌های هوشمند (قابل کشیدن با دست)"
      title="کشیدن به چپ یا لمس برای باز کردن اسلایدر نوتیفیکیشن • کشیدن بالا/پایین برای جابجایی دائمی"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="fixed right-0 md:right-20 lg:right-64 z-40 touch-none select-none flex items-center justify-center focus:outline-none"
      style={{
        top: `${yPct}%`,
        transform: `translate(${pullOffsetX}px, -50%) scale(${dragging ? 1.05 : 1})`,
        width: '40px',
        height: '86px',
        transition: dragging ? 'none' : 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* Authentic QBank Smooth Curved Right-Edge Ear Silhouette (Screenshot 3 & 4 exact ear curve) */}
      <svg
        viewBox="0 0 40 86"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          filter: dragging
            ? 'drop-shadow(-4px 5px 14px rgba(79, 70, 229, 0.28))'
            : 'drop-shadow(-2px 3px 10px rgba(15, 23, 42, 0.14))',
        }}
      >
        <path
          d="M 40,0 C 40,13 31,15 20,18 C 8,21 3,30 3,43 C 3,56 8,65 20,68 C 31,71 40,73 40,86 Z"
          fill="#FFFFFF"
          stroke="#CBD5E1"
          strokeWidth="1.4"
        />
      </svg>

      {/* Authentic QBank Filled Dark-Slate Swinging Bell + Bright Red Alert Dot/Count */}
      <div className="relative z-10 flex items-center justify-center pl-1.5">
        <Bell
          size={19}
          strokeWidth={2.2}
          fill={notifCount > 0 ? '#0F172A' : 'none'}
          className={notifCount > 0 ? 'text-slate-900 bell-swing' : 'text-slate-700'}
        />
        {notifCount > 0 && (
          <span
            className="absolute -top-2 -left-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-600 text-white text-[8.5px] font-black flex items-center justify-center border-2 border-white shadow-sm"
            data-testid="right_edge_bell_badge"
          >
            {notifCount > 99 ? '99+' : notifCount.toLocaleString('fa-IR')}
          </span>
        )}
      </div>
    </button>
  );
}
