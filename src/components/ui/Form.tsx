import { type ReactNode } from 'react';

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
  children: ReactNode;
};

export function Field({ label, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center px-1">
        <label className="text-xs font-semibold text-gray-500 tracking-tight">{label}</label>
        {error && <span className="text-[10px] font-bold text-red-500 animate-fade-in">{error}</span>}
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
      className={`w-full px-4 py-3 rounded-2xl bg-white/50 border border-white/50 text-gray-800 placeholder:text-gray-400 text-sm transition-all focus:bg-white focus:border-blue-300 focus:ring-4 focus:ring-blue-100/50 ${props.className ?? ''}`}
      style={{ transition: 'all 0.25s var(--ease-out)' }}
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
        dir="ltr"
        className={`text-left font-bold ${props.className ?? ''}`}
        value={formatted}
        onChange={handleChange}
        placeholder={props.placeholder ?? '۰'}
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">
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
      className={`w-full px-4 py-3 rounded-2xl bg-white/50 border border-white/50 text-gray-800 placeholder:text-gray-400 text-sm transition-all focus:bg-white focus:border-blue-300 focus:ring-4 focus:ring-blue-100/50 resize-none ${props.className ?? ''}`}
      style={{ transition: 'all 0.25s var(--ease-out)' }}
    />
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] };
export function Select({ options, ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={`w-full px-4 py-3 rounded-2xl bg-white/50 border border-white/50 text-gray-800 text-sm transition-all focus:bg-white focus:border-blue-300 focus:ring-4 focus:ring-blue-100/50 appearance-none cursor-pointer ${props.className ?? ''}`}
      style={{ transition: 'all 0.25s var(--ease-out)' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
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
  const base = 'flex items-center justify-center gap-2 py-3 px-4 rounded-2xl font-semibold text-sm transition-all haptic active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';
  const styles: Record<string, string> = {
    primary: color ? 'text-white' : 'bg-blue-500 text-white hover:bg-blue-600',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-100',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles[variant]} ${className}`}
      style={
        variant === 'primary' && color
          ? { background: color, boxShadow: `0 4px 16px ${color}35` }
          : variant === 'danger'
          ? { boxShadow: '0 4px 16px rgba(239,68,68,0.3)' }
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
