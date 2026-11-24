import { type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';

/* Iranian National Code Validator */
export function isValidIranianNationalId(id: string): boolean {
  if (!/^\d{10}$/.test(id)) return false;
  if (/^(\d)\1{9}$/.test(id)) return false; // all identical digits
  const check = parseInt(id[9], 10);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(id[i], 10) * (10 - i);
  }
  const rem = sum % 11;
  return (rem < 2 && check === rem) || (rem >= 2 && check === 11 - rem);
}

type FieldProps = {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
};

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <div className="ios27-form-field flex flex-col gap-1.5">
      <div className="flex justify-between items-center px-1">
        <label className="text-[11px] font-extrabold text-slate-600 tracking-tight">{label}</label>
        {error ? (
          <span className="text-[10px] font-bold text-rose-600 animate-fade-in">{error}</span>
        ) : hint ? (
          <span className="text-[10px] font-medium text-slate-400">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export function Input(props: InputProps) {
  return (
    <input
      {...props}
      className={`ios27-input w-full px-3.5 py-2.5 rounded-2xl bg-white border border-slate-200/90 text-slate-900 placeholder:text-slate-400 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 ${props.className ?? ''}`}
      style={{ transition: 'all 0.2s var(--ease-out)' }}
    />
  );
}

type CurrencyInputProps = Omit<InputProps, 'onChange'> & {
  value: number | string;
  onChange: (val: number) => void;
  currencyLabel?: string;
};

export function CurrencyInput({ value, onChange, currencyLabel = 'تومان', ...props }: CurrencyInputProps) {
  const numericVal = typeof value === 'number' ? value : parseInt(String(value).replace(/\D/g, '') || '0', 10);
  const formatted = numericVal > 0 ? numericVal.toLocaleString('fa-IR') : '';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d۰-۹]/g, '');
    const eng = raw.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
    const num = parseInt(eng || '0', 10);
    onChange(num);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        dir="ltr"
        className={`text-left font-black pl-14 ${props.className ?? ''}`}
        value={formatted}
        onChange={handleChange}
        placeholder={props.placeholder ?? '۰'}
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-extrabold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-lg pointer-events-none">
        {currencyLabel}
      </span>
    </div>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
export function Textarea(props: TextareaProps) {
  return (
    <textarea
      {...props}
      className={`ios27-input w-full px-3.5 py-2.5 rounded-2xl bg-white border border-slate-200/90 text-slate-900 placeholder:text-slate-400 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 resize-none ${props.className ?? ''}`}
      style={{ transition: 'all 0.2s var(--ease-out)' }}
    />
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] };
export function Select({ options, onChange, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        {...props}
        onChange={(e) => {
          playTactileFeedback('soft');
          onChange?.(e);
        }}
        className={`ios27-select w-full px-3.5 py-2.5 pl-9 rounded-2xl bg-white border border-slate-200/90 text-slate-900 text-sm font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/12 appearance-none cursor-pointer ${props.className ?? ''}`}
        style={{ transition: 'all 0.2s var(--ease-out)' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  color?: string;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
};

export function Button({ children, onClick, type = 'button', variant = 'primary', color, className = '', disabled, icon }: ButtonProps) {
  const base = 'ios27-button flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-extrabold text-sm transition-all haptic active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';
  const styles: Record<string, string> = {
    primary: color ? 'text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700',
    secondary: 'bg-slate-100 text-slate-700 border border-slate-200/80 hover:bg-slate-200/80',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  };
  return (
    <button
      type={type}
      onClick={() => {
        if (!disabled) playTactileFeedback(variant === 'danger' ? 'warning' : 'tap');
        onClick?.();
      }}
      disabled={disabled}
      className={`${base} ${styles[variant]} ${className}`}
      style={
        variant === 'primary' && color
          ? { background: color, boxShadow: `0 6px 18px ${color}30` }
          : variant === 'danger'
          ? { boxShadow: '0 6px 18px rgba(225,29,72,0.28)' }
          : undefined
      }
    >
      {icon}
      {children}
    </button>
  );
}

type BadgeProps = {
  children: ReactNode;
  color?: string;
  bg?: string;
};

export function Badge({ children, color, bg }: BadgeProps) {
  return (
    <span
      className="badge"
      style={{
        color: color ?? '#374151',
        background: bg ?? 'rgba(0,0,0,0.06)',
      }}
    >
      {children}
    </span>
  );
}

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  color?: string;
};

export function EmptyState({ icon, title, subtitle, color = '#9CA3AF' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
      <div
        className="w-18 h-18 rounded-3xl flex items-center justify-center mb-4 animate-float"
        style={{
          background: `${color}12`,
          color,
          width: 72,
          height: 72,
          boxShadow: `0 8px 24px ${color}10`,
        }}
      >
        {icon}
      </div>
      <h3 className="text-base font-bold text-gray-700 mb-1">{title}</h3>
      {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
    </div>
  );
}

type LoadingProps = { color?: string };
export function Loading({ color = '#3B82F6' }: LoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div
        className="w-12 h-12 rounded-full border-[3px] border-transparent animate-spin-slow"
        style={{
          borderTopColor: color,
          borderRightColor: color,
          borderBottomColor: `${color}25`,
          borderLeftColor: `${color}25`,
        }}
      />
      <p className="text-xs text-gray-400 mt-3 font-medium">در حال بارگذاری...</p>
    </div>
  );
}
