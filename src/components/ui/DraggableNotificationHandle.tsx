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

  const lastDraggedAtRef = useRef<number>(0);
  const lastOpenedAtRef = useRef<number>(0);

  const dragStateRef = useRef<{
    pointerId: number | null;
    startY: number;
    startX: number;
    startPct: number;
    draggingY: boolean;
    swipedOpen: boolean;
  }>({
    pointerId: null,
    startY: 0,
    startX: 0,
    startPct: 58,
    draggingY: false,
    swipedOpen: false,
  });

  if (open) return null;

  const clampPct = (val: number) => Math.min(78, Math.max(16, val));

  const triggerOpen = () => {
    const now = Date.now();
    if (now - lastOpenedAtRef.current < 260) return;
    lastOpenedAtRef.current = now;
    playTactileFeedback('drawer');
    onOpen();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture is unsupported
    }
    dragStateRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startX: e.clientX,
      startPct: yPct,
      draggingY: false,
      swipedOpen: false,
    };
    setDragging(true);
    setPullOffsetX(0);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (st.pointerId !== e.pointerId) return;

    const dy = e.clientY - st.startY;
    const dx = e.clientX - st.startX;

    // Live horizontal finger pull feedback from the right edge
    if (!st.draggingY && dx < -4 && Math.abs(dx) > Math.abs(dy) * 0.9) {
      setPullOffsetX(Math.max(-24, dx * 0.45));
    }

    // Swipe left with finger opens drawer immediately
    if (!st.draggingY && dx < -22 && Math.abs(dy) < 34) {
      st.pointerId = null;
      st.swipedOpen = true;
      setDragging(false);
      setPullOffsetX(0);
      triggerOpen();
      return;
    }

    // Only treat as vertical reposition once finger moves > 14px vertically
    if (Math.abs(dy) > 14 && Math.abs(dy) >= Math.abs(dx) && typeof window !== 'undefined' && window.innerHeight > 0) {
      st.draggingY = true;
      lastDraggedAtRef.current = Date.now();
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

    const wasDraggingY = st.draggingY;
    const wasSwiped = st.swipedOpen;
    st.pointerId = null;
    setDragging(false);
    setPullOffsetX(0);

    if (wasSwiped) return;

    if (!wasDraggingY) {
      triggerOpen();
    } else {
      lastDraggedAtRef.current = Date.now();
      playTactileFeedback('soft');
      try {
        localStorage.setItem(HANDLE_Y_STORAGE_KEY, yPct.toFixed(2));
      } catch {
        // ignore
      }
    }
  };

  const handlePointerCancel = () => {
    dragStateRef.current.pointerId = null;
    setDragging(false);
    setPullOffsetX(0);
  };

  const handleClick = () => {
    // Fallback for browsers where click fires after pointerup or without pointer events
    if (Date.now() - lastDraggedAtRef.current < 280) return;
    triggerOpen();
  };

  return (
    <button
      type="button"
      data-testid="right_edge_draggable_bell_handle"
      aria-label="اعلان‌ها و یادآوری‌ها"
      title="باز کردن لیست اعلان‌ها"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      className="fixed right-0 md:right-20 lg:right-64 z-[45] touch-none select-none flex items-center justify-center focus:outline-none cursor-pointer"
      style={{
        top: `${yPct}%`,
        transform: `translate(${pullOffsetX}px, -50%) scale(${dragging ? 1.05 : 1})`,
        width: '30px',
        height: '72px',
        transition: dragging ? 'none' : 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* Smooth Curved Right-Edge Ear Silhouette (Non-Overlapping Safe Gutter) */}
      <svg
        viewBox="0 0 28 72"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          filter: dragging
            ? 'drop-shadow(-4px 5px 12px rgba(79, 70, 229, 0.26))'
            : 'drop-shadow(-2px 3px 8px rgba(15, 23, 42, 0.12))',
        }}
      >
        <path
          className="right-bell-ear-path"
          d="M 28,0 C 28,11 21,13 14,16 C 5,19 2,26 2,36 C 2,46 5,53 14,56 C 21,59 28,61 28,72 Z"
          fill="#FFFFFF"
          stroke="#CBD5E1"
          strokeWidth="1.25"
        />
      </svg>

      {/* Filled Dark-Slate Swinging Bell + Red Alert Badge */}
      <div className="relative z-10 flex items-center justify-center pl-0.5 pointer-events-none">
        <Bell
          size={15}
          strokeWidth={2.2}
          fill={notifCount > 0 ? '#0F172A' : 'none'}
          className={notifCount > 0 ? 'text-slate-900 right-bell-icon bell-swing' : 'text-slate-700 right-bell-icon'}
        />
        {notifCount > 0 && (
          <span
            className="absolute -top-2 -left-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-600 text-white text-[8px] font-black flex items-center justify-center border-[1.5px] border-white dark:border-[#162738] shadow-sm"
            data-testid="right_edge_bell_badge"
          >
            {notifCount > 99 ? '99+' : notifCount.toLocaleString('fa-IR')}
          </span>
        )}
      </div>
    </button>
  );
}
