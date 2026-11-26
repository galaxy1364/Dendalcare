import { todayGregorian } from '@/lib/jalali';

export const fmtToman = (n: number) => Number(n || 0).toLocaleString('fa-IR');

export const TXN_TYPES = [
  { value: 'income', label: 'درآمد' },
  { value: 'expense', label: 'هزینه' },
  { value: 'transfer', label: 'انتقال بین حساب (خارج از درآمد)' },
];

export const CATEGORIES = [
  { value: 'patient_payment', label: 'پرداخت بیمار' },
  { value: 'salary', label: 'تسویه سهم پزشک / حقوق' },
  { value: 'rent', label: 'اجاره' },
  { value: 'utilities', label: 'قبوض' },
  { value: 'supplies', label: 'تجهیزات مصرفی' },
  { value: 'equipment', label: 'تجهیزات' },
  { value: 'lab_cost', label: 'هزینه لابراتوار' },
  { value: 'maintenance', label: 'تعمیر و نگهداری' },
  { value: 'marketing', label: 'تبلیغات' },
  { value: 'tax', label: 'مالیات' },
  { value: 'other', label: 'سایر' },
];

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقدی' },
  { value: 'card', label: 'کارت‌خوان' },
  { value: 'transfer', label: 'انتقال بانکی' },
  { value: 'insurance', label: 'بیمه' },
];

export const INSTALLMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'فعال', color: '#22C55E', bg: '#DCFCE7' },
  completed: { label: 'تکمیل‌شده', color: '#3B82F6', bg: '#DBEAFE' },
  overdue: { label: 'سررسید گذشته', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'لغوشده', color: '#9CA3AF', bg: '#F3F4F6' },
};

export const CHECK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'در جریان', color: '#F59E0B', bg: '#FEF3C7' },
  cleared: { label: 'پاس‌شده', color: '#22C55E', bg: '#DCFCE7' },
  bounced: { label: 'برگشتی', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'لغوشده', color: '#9CA3AF', bg: '#F3F4F6' },
};

export function addDaysToIso(dateStr: string, daysOffset: number): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return todayGregorian();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}
