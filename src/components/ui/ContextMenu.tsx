import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { HapticEngine } from '@/lib/hapticsAudio';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}

interface ContextMenuTriggerProps {
  items: ContextMenuItem[];
  title?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Reusable Native-Like Long Press (450ms) + Desktop Right-Click Context Menu
 */
export function ContextMenuTrigger({
  items,
  title,
  testId,
  className = '',
  children,
}: ContextMenuTriggerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const holdTimer = useRef<number | null>(null);
  const startCoord = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  const clearTimer = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const openAt = (clientX: number, clientY: number) => {
    HapticEngine.impact('medium');
    const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
    const safeX = Math.max(16, Math.min(vw - 246, clientX - 115));
    const safeY = Math.max(20, Math.min(vh - 220, clientY - 24));
    setPos({ x: safeX, y: safeY });
    setOpen(true);
  };

  return (
    <>
      <div
        data-testid={testId}
        className={className}
        onContextMenu={(e) => {
          if (items.length === 0) return;
          e.preventDefault();
          e.stopPropagation();
          openAt(e.clientX, e.clientY);
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          longPressFired.current = false;
          startCoord.current = { x: e.clientX, y: e.clientY };
          clearTimer();
          holdTimer.current = window.setTimeout(() => {
            longPressFired.current = true;
            openAt(e.clientX, e.clientY);
          }, 450);
        }}
        onPointerMove={(e) => {
          if (!startCoord.current || holdTimer.current === null) return;
          const dist = Math.hypot(e.clientX - startCoord.current.x, e.clientY - startCoord.current.y);
          if (dist > 10) clearTimer();
        }}
        onPointerUp={() => clearTimer()}
        onPointerCancel={() => clearTimer()}
        onClickCapture={(e) => {
          if (longPressFired.current) {
            e.preventDefault();
            e.stopPropagation();
            longPressFired.current = false;
          }
        }}
      >
        {children}
      </div>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[130] bg-slate-950/35 backdrop-blur-[2px] animate-fade-in"
            dir="rtl"
            onClick={() => setOpen(false)}
          >
            <div
              role="menu"
              data-testid={testId ? `${testId}_context_menu` : 'ios27_context_menu'}
              onClick={(e) => e.stopPropagation()}
              style={{ top: pos.y, left: pos.x }}
              className="fixed w-[230px] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden animate-scale-in"
            >
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
                <span className="text-[11px] font-black text-slate-800 dark:text-slate-100 truncate">
                  {title || 'عملیات سریع'}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="بستن منو"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="p-1.5 space-y-0.5">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      HapticEngine.selection();
                      setOpen(false);
                      item.onSelect();
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-xl text-xs font-extrabold text-right transition-colors min-h-[44px] ${
                      item.destructive
                        ? 'text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40'
                        : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {item.icon && <span className="shrink-0">{item.icon}</span>}
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
