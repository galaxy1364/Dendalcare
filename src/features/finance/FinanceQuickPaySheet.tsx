import { Wallet } from 'lucide-react';
import type { Patient } from '@/lib/supabase';
import { Sheet } from '@/components/ui/Sheet';
import { Button, Field, Input, Select } from '@/components/ui/Form';
import type { ChargeAllocationInput } from './financialCommandTypes';
import { fmtToman, PAYMENT_METHODS } from './financeConstants';

export function FinanceQuickPaySheet({
  patient,
  amount,
  method,
  error,
  saving,
  allocationPreview,
  onAmountChange,
  onMethodChange,
  onClose,
  onSubmit,
}: {
  patient: Patient | null;
  amount: string;
  method: 'cash' | 'card' | 'transfer' | 'insurance';
  error: string | null;
  saving: boolean;
  allocationPreview: { allocations: ChargeAllocationInput[]; unappliedCreditToman: number } | null;
  onAmountChange: (value: string) => void;
  onMethodChange: (value: 'cash' | 'card' | 'transfer' | 'insurance') => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Sheet
      open={!!patient}
      onClose={onClose}
      title={patient ? `ثبت دریافت وجه از ${patient.first_name} ${patient.last_name}` : ''}
      icon={<Wallet size={20} />}
      color="#10B981"
    >
      <div className="space-y-3.5" data-testid="finance_quick_pay_sheet">
        <Field label="مبلغ دریافتی به تومان (اعداد فارسی یا لاتین بدون اعشار)">
          <Input
            type="text"
            inputMode="numeric"
            data-testid="quick_pay_amount_input"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="مثلاً ۵۰۰۰۰۰"
          />
        </Field>
        <Field label="روش پرداخت">
          <Select value={method} onChange={(e) => onMethodChange(e.target.value as any)} options={PAYMENT_METHODS} />
        </Field>
        {allocationPreview && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-[11px] text-emerald-900 space-y-1">
            <p className="font-bold">پیش‌نمایش تخصیص اتمیک:</p>
            <p>
              تخصیص به درمان‌ها: <b>{fmtToman(allocationPreview.allocations.reduce((s, a) => s + a.amount, 0))} ت</b>
            </p>
            {allocationPreview.unappliedCreditToman > 0 && (
              <p>
                ثبت به عنوان اعتبار بستانکار بیمار: <b>{fmtToman(allocationPreview.unappliedCreditToman)} ت</b>
              </p>
            )}
          </div>
        )}
        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-[11px] font-bold text-rose-700" data-testid="quick_pay_error_banner">
            {error}
          </div>
        )}
        <Button color="#10B981" data-testid="quick_pay_submit_button" disabled={saving || !amount} onClick={onSubmit} className="w-full">
          {saving ? 'در حال ثبت اتمیک...' : 'تأیید و ثبت در دفتر کل'}
        </Button>
      </div>
    </Sheet>
  );
}
