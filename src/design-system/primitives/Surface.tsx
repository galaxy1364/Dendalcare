import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

interface CardSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'muted';
}

export function CardSurface({
  children,
  variant = 'default',
  className = '',
  ...rest
}: CardSurfaceProps) {
  const variantCls =
    variant === 'muted'
      ? 'bg-[var(--md-muted-surface,#EEF3F7)] border-[var(--md-border,#D8E2EA)]'
      : variant === 'elevated'
      ? 'bg-[var(--md-surface,#FFFFFF)] border-[var(--md-border,#D8E2EA)] shadow-md'
      : 'bg-[var(--md-surface,#FFFFFF)] border-[var(--md-border,#D8E2EA)] shadow-sm';

  return (
    <div
      className={`min-w-0 rounded-[var(--radius-card,20px)] border text-[var(--md-text,#14283B)] ${variantCls} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

interface TouchButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: 'primary' | 'navy' | 'neutral' | 'critical';
}

export function TouchButton({
  children,
  tone = 'primary',
  className = '',
  type = 'button',
  ...rest
}: TouchButtonProps) {
  const toneCls =
    tone === 'primary'
      ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
      : tone === 'navy'
      ? 'bg-[var(--md-navy)] text-[var(--md-on-navy)]'
      : tone === 'critical'
      ? 'bg-[var(--md-critical)] text-[var(--md-on-critical)]'
      : 'bg-[var(--md-surface)] text-[var(--md-text)] border border-[var(--md-border)]';

  return (
    <button
      type={type}
      className={`min-h-[48px] min-w-[48px] rounded-[var(--radius-btn,12px)] px-4 py-2 font-bold inline-flex items-center justify-center gap-2 transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--md-primary)] enabled:hover:opacity-90 disabled:opacity-50 ${toneCls} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
