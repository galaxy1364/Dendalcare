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
      className={`rounded-[20px] border text-[var(--md-text,#14283B)] ${variantCls} ${className}`}
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
      ? 'bg-[#087C76] text-white hover:bg-[#06635E]'
      : tone === 'navy'
      ? 'bg-[#142E43] text-white hover:bg-[#0E2233]'
      : tone === 'critical'
      ? 'bg-[#AD293C] text-white hover:bg-[#912031]'
      : 'bg-white dark:bg-[#11202E] text-[#14283B] dark:text-[#F1F5F9] border border-[#D8E2EA] dark:border-[#25394D]';

  return (
    <button
      type={type}
      className={`min-h-[48px] min-w-[48px] rounded-[12px] px-4 py-2 font-bold inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#087C76] disabled:opacity-50 ${toneCls} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
