import type { ReactNode } from 'react';
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
  /** Custom Duotone icon rendered in 28px–32px slot */
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
  /** Compact mode for tighter multi-column placement while staying within 96px–112px */
  compact?: boolean;
  /** Optional test ID */
  testId?: string;
  onClick: () => void;
}

/**
 * FIX 02 — Exact QBank Curved-Notch Card Geometry (RTL)
 *
 * Matches the user's QBank reference screenshots with:
 * - Main corner radius: 22px
 * - Smooth carved bottom-left curved pocket cutout (zero sharp corners)
 * - Standalone visual arrow pill nestled cleanly inside the cutout
 * - Adaptive height: 96px (compact) to 108px–112px (standard)
 * - Typography: 15px bold title (14–16px) & 13px subtitle (13–14px)
 * - Custom Filled Duotone icon slot (28–32px)
 * - Full-card tap target with crisp pearl/pastel gradient surface
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
  const gradId = `qbt-${label.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '')}-${color.replace('#', '')}`;
  const effectiveDark = darkColor || color;
  const effectiveBorder = borderColor || `${color}45`;
  const tileHeight = compact ? '96px' : '108px';

  const handleClick = () => {
    playTactileFeedback('tap');
    onClick();
  };

  return (
    <div
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
      className="qbank-notch-card group relative w-full select-none cursor-pointer"
      style={{ minHeight: tileHeight }}
    >
      {/* Curved-Notch Card Path (22px main corners + smooth tangent-continuous bottom-left pocket) */}
      <svg
        viewBox="0 0 220 104"
        preserveAspectRatio="none"
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
            <stop offset="0%" stopColor={surfaceBg} />
            <stop offset="55%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor={surfaceBgEnd || surfaceBg} />
          </linearGradient>
        </defs>
        <path
          d="M 22,1 H 198 A 21,21 0 0 1 219,22 V 82 A 21,21 0 0 1 198,103 H 62 A 14,14 0 0 1 48,89 V 76 A 14,14 0 0 0 34,62 H 22 A 21,21 0 0 1 1,41 V 22 A 21,21 0 0 1 22,1 Z"
          fill={`url(#${gradId})`}
          stroke={selected ? color : effectiveBorder}
          strokeWidth={selected ? '2.2' : '1.4'}
        />
      </svg>

      {/* Card Inner Content (RTL: title & subtitle right-aligned top-to-bottom; duotone icon top-left; zero overlap with cutout) */}
      <div
        className="relative z-10 flex flex-col justify-between h-full px-3.5 py-2.5"
        style={{ minHeight: tileHeight }}
      >
        <div className="flex items-start justify-between gap-2">
          {/* RTL Start (Right): Title (14-16px) & Subtitle (13-14px) */}
          <div className="min-w-0 flex-1 text-right pt-0.5">
            <p className="text-[15px] font-black text-[#14283B] leading-snug truncate">
              {label}
            </p>
            {sub ? (
              <p className="text-[13px] font-semibold text-[#526779] leading-snug truncate mt-0.5">
                {sub}
              </p>
            ) : value !== undefined ? (
              <p
                className="text-[13px] font-bold tabular-nums leading-snug truncate mt-0.5"
                style={{ color: effectiveDark }}
              >
                {typeof value === 'number' ? `${value.toLocaleString('fa-IR')} مورد` : value}
              </p>
            ) : null}
          </div>

          {/* RTL End (Left Top): Custom Duotone Icon Slot (28–32px) */}
          <div
            className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-transform duration-150 group-active:scale-92"
            style={{
              background: '#FFFFFF',
              border: `1.5px solid ${effectiveBorder}`,
              boxShadow: `0 3px 8px ${color}1A`,
            }}
          >
            {icon}
          </div>
        </div>

        {/* Bottom-Right Shelf (Opposite the bottom-left cutout): live count pill or badge */}
        <div className="flex items-center justify-start gap-1.5 pl-[48px]">
          {value !== undefined && sub && (
            <span
              className="text-[12px] font-black px-2 py-0.5 rounded-full tabular-nums"
              style={{
                background: '#FFFFFF',
                color: effectiveDark,
                border: `1px solid ${effectiveBorder}`,
              }}
            >
              {typeof value === 'number' ? value.toLocaleString('fa-IR') : value}
            </span>
          )}
          {badge && (
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: '#FFFFFF',
                color: effectiveDark,
                border: `1px solid ${effectiveBorder}`,
              }}
            >
              {badge}
            </span>
          )}
        </div>
      </div>

      {/* Standalone Visual Arrow Pill Nestled Inside the Bottom-Left Carved Cutout */}
      <div
        aria-hidden="true"
        className="qbank-pocket-btn absolute bottom-[2px] left-[2px] z-10 w-[40px] h-[34px] rounded-[13px] flex items-center justify-center transition-transform duration-150"
        style={{
          background: `linear-gradient(145deg, #FFFFFF 0%, ${surfaceBgEnd || surfaceBg} 100%)`,
          color: effectiveDark,
          border: `1.3px solid ${effectiveBorder}`,
          boxShadow: `0 3px 8px ${color}24`,
        }}
      >
        <ChevronLeft size={17} strokeWidth={2.5} className="qbank-spring-arrow" />
      </div>
    </div>
  );
}
