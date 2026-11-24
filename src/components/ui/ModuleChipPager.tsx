import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';

export interface ChipPagerItem<T extends string = string> {
  key: T;
  label: string;
  icon?: ReactNode;
  badge?: number | string;
}

interface ModuleChipPagerProps<T extends string> {
  items: ChipPagerItem<T>[];
  activeKey: T;
  onSelect: (key: T) => void;
  color: string;
  /** Number of chips per page (defaults to 3 for effortless 1-handed reach) */
  pageSize?: number;
  /** Optional expandable magnifying-glass search */
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  /** Optional trailing action button (e.g., Add "+") */
  actionSlot?: ReactNode;
  testIdPrefix?: string;
}

/**
 * Pageable & Touch-Swipeable Module Chip Bar
 * Trace ID: TRC-MINA-QBANK-9008-H
 *
 * Groups module tabs into clean reachable pages with swipe navigation,
 * animated magnifying-glass search, and iOS 27 tactile feedback.
 */
export function ModuleChipPager<T extends string>({
  items,
  activeKey,
  onSelect,
  color,
  pageSize = 3,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'جستجو...',
  actionSlot,
  testIdPrefix = 'module',
}: ModuleChipPagerProps<T>) {
  const [searchOpen, setSearchOpen] = useState(false);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const activeIdx = Math.max(0, items.findIndex((i) => i.key === activeKey));
  const [page, setPage] = useState<number>(() => Math.floor(activeIdx / pageSize));
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const targetPage = Math.floor(activeIdx / pageSize);
    setPage(targetPage);
  }, [activeIdx, pageSize]);

  const visibleItems = useMemo(() => {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const goToPage = (nextPage: number) => {
    const clamped = Math.max(0, Math.min(totalPages - 1, nextPage));
    if (clamped !== page) {
      playTactileFeedback('soft');
      setPage(clamped);
    }
  };

  return (
    <div
      className="glass-card p-2.5 space-y-2"
      data-testid={`${testIdPrefix}_chip_pager`}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null || totalPages <= 1) return;
        const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
        const dx = endX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) > 40) {
          // RTL swipe: swiping right advances to next page, left returns
          goToPage(dx > 0 ? page + 1 : page - 1);
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        {onSearchChange && (
          <button
            type="button"
            onClick={() => {
              playTactileFeedback('soft');
              setSearchOpen((prev) => !prev);
            }}
            data-testid={`${testIdPrefix}_search_toggle`}
            aria-label="جستجو"
            className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic"
            style={{
              background: searchOpen || searchValue ? color : `${color}16`,
              color: searchOpen || searchValue ? '#FFFFFF' : color,
            }}
          >
            {searchOpen ? <X size={16} /> : <Search size={16} />}
          </button>
        )}

        {/* Current Page of Chips */}
        <div className="flex-1 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}>
          {visibleItems.map((item) => {
            const isActive = item.key === activeKey;
            return (
              <button
                key={item.key}
                type="button"
                data-testid={`${testIdPrefix}_chip_${item.key}`}
                onClick={() => {
                  playTactileFeedback('tap');
                  onSelect(item.key);
                }}
                className="flex items-center justify-center gap-1 px-2 py-2 rounded-2xl text-[11px] font-extrabold transition-all haptic truncate"
                style={{
                  background: isActive ? color : 'rgba(241, 245, 249, 0.9)',
                  color: isActive ? '#FFFFFF' : '#334155',
                  boxShadow: isActive ? `0 4px 12px ${color}38` : 'none',
                }}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-black shrink-0"
                    style={{
                      background: isActive ? 'rgba(255,255,255,0.22)' : `${color}18`,
                      color: isActive ? '#FFFFFF' : color,
                    }}
                  >
                    {typeof item.badge === 'number' ? item.badge.toLocaleString('fa-IR') : item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {actionSlot && <div className="shrink-0">{actionSlot}</div>}
      </div>

      {/* Page Controls & Dots (shown whenever items span multiple pages) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pt-0.5">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => goToPage(page - 1)}
            aria-label="صفحه قبلی چیپ‌ها"
            data-testid={`${testIdPrefix}_chip_prev_page`}
            className="flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-lg disabled:opacity-35 transition-all"
            style={{ color }}
          >
            <ChevronRight size={13} />
            <span>صفحه قبل</span>
          </button>

          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalPages }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`صفحه ${idx + 1}`}
                onClick={() => goToPage(idx)}
                className="h-1.5 rounded-full transition-all duration-200"
                style={{
                  width: idx === page ? '20px' : '6px',
                  background: idx === page ? color : `${color}35`,
                }}
              />
            ))}
          </div>

          <button
            type="button"
            disabled={page === totalPages - 1}
            onClick={() => goToPage(page + 1)}
            aria-label="صفحه بعدی چیپ‌ها"
            data-testid={`${testIdPrefix}_chip_next_page`}
            className="flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-lg disabled:opacity-35 transition-all"
            style={{ color }}
          >
            <span>صفحه بعد</span>
            <ChevronLeft size={13} />
          </button>
        </div>
      )}

      {/* Animated Expandable Search Input */}
      {searchOpen && onSearchChange && (
        <div className="animate-slide-down pt-0.5">
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            className="w-full px-3.5 py-2 rounded-2xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-indigo-400"
          />
        </div>
      )}
    </div>
  );
}
