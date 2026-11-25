import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';

export interface QBankTileProps {
  /** Module accent color (hex) */
  color: string;
  /** High-contrast foreground shade for badge/text */
  darkColor?: string;
  /** Soft pastel surface background fill */
  surfaceBg: string;
  /** Secondary pastel stop for smooth luminous gradient */
  surfaceBgEnd?: string;
  /** Crisp pastel outline border */
  borderColor?: string;
  /** Custom Duotone icon rendered in 28px–32px top-right slot */
  icon: ReactNode;
  /** Primary Persian label (14px–16px) */
  label: string;
  /** Optional subtitle line (13px–14px) */
  sub?: string;
  /** Optional numeric or string live count */
  value?: number | string;
  /** Optional status pill */
  badge?: string;
  /** Highlight outline when selected */
  selected?: boolean;
  /** Compact mode (96px) vs standard (108px) */
  compact?: boolean;
  /** Optional test ID */
  testId?: string;
  onClick: () => void;
}

/**
 * Pure pixel-true SVG path generator (FIX 07):
 * Computes exact circular arcs for the 22px main corners and the bottom-left carved curved pocket
 * at the card's REAL measured `(width, height)` so curves NEVER stretch or distort on any aspect ratio.
 */
export function buildQBankNotchPath(
  width: number,
  height: number,
  cornerR = 22,
  notchW = 46,
  notchH = 38,
  innerR = 14
): string {
  const w = Math.max(120, Math.round(width));
  const h = Math.max(88, Math.round(height));
  const p = 1; // stroke inset
  const r = Math.min(cornerR, Math.floor((h - notchH) / 2) + 8, 22);
  const nw = Math.min(notchW, Math.floor(w * 0.42));
  const nh = Math.min(notchH, Math.floor(h * 0.46));
  const ir = Math.min(innerR, Math.floor(nw / 3), Math.floor(nh / 2.2));

  // Clockwise path starting at top-left after top-left radius
  // Main corners: top-left, top-right, bottom-right = r (22px)
  // Bottom-left carved pocket: smooth outer-concave + inner-convex fillets with zero sharp corners
  const topY = p;
  const bottomY = h - p;
  const leftX = p;
  const rightX = w - p;
  const pocketTopY = bottomY - nh;
  const pocketRightX = leftX + nw;

  return [
    `M ${leftX + r},${topY}`,
    `H ${rightX - r}`,
    `A ${r},${r} 0 0 1 ${rightX},${topY + r}`,
    `V ${bottomY - r}`,
    `A ${r},${r} 0 0 1 ${rightX - r},${bottomY}`,
    `H ${pocketRightX + ir}`,
    `A ${ir},${ir} 0 0 1 ${pocketRightX},${bottomY - ir}`,
    `V ${pocketTopY + ir}`,
    `A ${ir},${ir} 0 0 0 ${pocketRightX - ir},${pocketTopY}`,
    `H ${leftX + r}`,
    `A ${r},${r} 0 0 1 ${leftX},${pocketTopY - r}`,
    `V ${topY + r}`,
    `A ${r},${r} 0 0 1 ${leftX + r},${topY}`,
    'Z',
  ].join(' ');
}

/**
 * FIX 02 & FIX 07 — Exact QBank Curved-Notch Card Geometry (RTL, Pixel-True, Light & Dark)
 *
 * - Measured via ResizeObserver so the SVG `viewBox` matches real card dimensions (zero curve distortion)
 * - Filled Duotone icon placed in TOP-RIGHT (RTL start), matching QBank screenshots
 * - Smooth carved bottom-left curved pocket with standalone chevron `<` pill inside
 * - Adaptive height: 96px (compact) to 108px (standard), expands safely under Large Dynamic Type
 * - Crisp Light & Dark mode tokens via shared CSS variables and dark: classes
 */
export function QBankTile({
  color,
  darkColor,
  surfaceBg,
  surfaceBgEnd,
  borderColor,
  icon,
  label,
  sub,
  value,
  badge,
  selected,
  compact = false,
  testId,
  onClick,
}: QBankTileProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradId = `qbt-${uid}`;
  const cardRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({
    w: 184,
    h: compact ? 96 : 108,
  });

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        setBoxSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveDark = darkColor || color;
  const effectiveBorder = borderColor || `${color}45`;
  const tileMinHeight = compact ? 96 : 108;
  const pathD = buildQBankNotchPath(boxSize.w, Math.max(boxSize.h, tileMinHeight), 22, 46, 38, 14);

  const handleClick = () => {
    playTactileFeedback('tap');
    onClick();
  };

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={label}
      data-testid={testId}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className="qbank-notch-card group relative w-full select-none cursor-pointer rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76] focus-visible:ring-offset-2"
      style={{
        minHeight: `${tileMinHeight}px`,
        ['--qbt-start' as string]: surfaceBg,
        ['--qbt-end' as string]: surfaceBgEnd || surfaceBg,
        ['--qbt-accent' as string]: color,
        ['--qbt-accent-dark' as string]: effectiveDark,
        ['--qbt-border' as string]: effectiveBorder,
      }}
    >
      {/* Pixel-True Curved-Notch SVG (Zero preserveAspectRatio="none" distortion) */}
      <svg
        viewBox={`0 0 ${boxSize.w} ${Math.max(boxSize.h, tileMinHeight)}`}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none qbank-notch-svg"
        style={{
          filter: selected
            ? `drop-shadow(0 0 0 2px ${color}) drop-shadow(0 8px 18px ${color}33)`
            : 'drop-shadow(0 6px 14px rgba(15, 23, 42, 0.06)) drop-shadow(0 1px 3px rgba(15, 23, 42, 0.04))',
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: 'var(--qbt-fill-start, var(--qbt-start))' }} />
            <stop offset="52%" style={{ stopColor: 'var(--qbt-fill-mid, #FFFFFF)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--qbt-fill-end, var(--qbt-end))' }} />
          </linearGradient>
        </defs>
        <path
          d={pathD}
          fill={`url(#${gradId})`}
          stroke={selected ? color : 'var(--qbt-stroke, var(--qbt-border))'}
          strokeWidth={selected ? '2.2' : '1.4'}
        />
      </svg>

      {/* Card Inner Content (RTL: Top-Right Duotone Icon + Title/Subtitle beside it; Bottom-Left pocket kept clear) */}
      <div
        className="relative z-10 flex flex-col justify-between h-full px-3 py-2.5"
        style={{ minHeight: `${tileMinHeight}px` }}
      >
        <div className="flex items-start gap-2.5">
          {/* RTL Start (Top-Right): Custom Duotone Icon Slot (28–32px) matching QBank Screenshots */}
          <div
            data-testid={testId ? `${testId}_icon` : undefined}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-[14px] flex items-center justify-center shrink-0 bg-white dark:bg-[#16283B] transition-transform duration-150 group-active:scale-92"
            style={{
              border: `1.5px solid ${effectiveBorder}`,
              boxShadow: `0 3px 8px ${color}1A`,
            }}
          >
            {icon}
          </div>

          {/* Title (14-16px, clean 2-line wrap) & Subtitle (13-14px) */}
          <div className="min-w-0 flex-1 text-right pt-0.5">
            <p
              title={label}
              className="text-[14px] sm:text-[15px] font-black text-[#14283B] dark:text-[#F1F5F9] leading-snug line-clamp-2"
            >
              {label}
            </p>
            {sub ? (
              <p className="text-[13px] sm:text-[13.5px] font-semibold text-[#526779] dark:text-[#9FB1C1] leading-snug line-clamp-1 mt-0.5">
                {sub}
              </p>
            ) : value !== undefined ? (
              <p
                className="text-[13px] sm:text-[13.5px] font-bold tabular-nums leading-snug line-clamp-1 mt-0.5 dark:text-[#CBD5E1]"
                style={{ color: effectiveDark }}
              >
                {typeof value === 'number' ? `${value.toLocaleString('fa-IR')} مورد` : value}
              </p>
            ) : null}
          </div>
        </div>

        {/* Bottom-Right Shelf (Opposite the bottom-left cutout): live count pill or badge */}
        <div className="flex items-center justify-start gap-1.5 pl-[48px] min-h-[22px]">
          {value !== undefined && sub && (
            <span
              className="text-[12px] font-black px-2 py-0.5 rounded-full tabular-nums bg-white dark:bg-[#16283B] dark:text-[#F1F5F9]"
              style={{
                color: effectiveDark,
                border: `1px solid ${effectiveBorder}`,
              }}
            >
              {typeof value === 'number' ? value.toLocaleString('fa-IR') : value}
            </span>
          )}
          {badge && (
            <span
              className="text-[12px] font-bold px-2 py-0.5 rounded-full bg-white dark:bg-[#16283B] dark:text-[#F1F5F9]"
              style={{
                color: effectiveDark,
                border: `1px solid ${effectiveBorder}`,
              }}
            >
              {badge}
            </span>
          )}
        </div>
      </div>

      {/* Standalone Visual Arrow Pill Nestled Cleanly Inside the Bottom-Left Carved Cutout */}
      <div
        aria-hidden="true"
        className="qbank-pocket-btn absolute bottom-[2px] left-[2px] z-10 w-[40px] h-[33px] rounded-[13px] flex items-center justify-center bg-white dark:bg-[#182C40] transition-transform duration-150"
        style={{
          color: effectiveDark,
          border: `1.3px solid ${effectiveBorder}`,
          boxShadow: `0 3px 8px ${color}24`,
        }}
      >
        <ChevronLeft size={17} strokeWidth={2.5} className="qbank-spring-arrow dark:text-[#E2E8F0]" />
      </div>
    </div>
  );
}
