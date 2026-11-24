/**
 * MinaDental 3-Mode Doctor Share & Manager Net Earnings Engine
 * Trace ID: TRC-MINA-GUARD-9007-G
 *
 * Implements all 3 clinic compensation formulas plus distinct Clinic Owner / Manager math:
 * 1. `net_half_after_lab`: (Gross Work - Total Lab Cost) / 2
 * 2. `fixed`: Manual fixed fee per surgery/treatment × count
 * 3. `percentage`: Custom percentage per doctor (with optional lab deduction)
 * 4. Clinic Manager (`دکتر مهدی امیری`): Net clinic profit after lab & associate shares
 */

export type DoctorShareMode = 'net_half_after_lab' | 'fixed' | 'percentage';

export interface DoctorShareCalculationInput {
  mode: DoctorShareMode;
  grossWorkAmount: number;
  labCostAmount: number;
  /** Percentage (e.g. 40 for 40%) when mode='percentage', or fixed fee per procedure when mode='fixed' */
  shareValue: number;
  /** Number of surgeries/treatments for fixed mode (defaults to 1) */
  procedureCount?: number;
  /** If true in percentage mode, lab cost is deducted before applying doctor percentage */
  deductLabInPercentageMode?: boolean;
  /** If true, calculates distinct owner/manager share (دکتر مهدی امیری) */
  isClinicManager?: boolean;
}

export interface DoctorShareCalculationResult {
  mode: DoctorShareMode;
  modeLabel: string;
  grossWork: number;
  labCost: number;
  netAfterLab: number;
  doctorShare: number;
  clinicShare: number;
  formulaDescription: string;
}

export const SHARE_MODE_LABELS: Record<DoctorShareMode, string> = {
  net_half_after_lab: 'نصف خالص پس از کسر لابراتوار ((کارکرد − لابراتوار) ÷ ۲)',
  fixed: 'دستمزد ثابت هر درمان / جراحی',
  percentage: 'درصدی اختصاصی پزشک',
};

export function calculateDoctorShare(input: DoctorShareCalculationInput): DoctorShareCalculationResult {
  const grossWork = Math.max(0, Number(input.grossWorkAmount) || 0);
  const labCost = Math.max(0, Number(input.labCostAmount) || 0);
  const netAfterLab = Math.max(0, grossWork - labCost);
  const count = Math.max(1, Number(input.procedureCount) || 1);
  const val = Math.max(0, Number(input.shareValue) || 0);

  // Clinic Owner / Lead Manager (دکتر مهدی امیری) receives 100% of net clinic margin on own work
  if (input.isClinicManager) {
    return {
      mode: input.mode,
      modeLabel: 'مدیر کلینیک و پزشک ارشد (دکتر مهدی امیری)',
      grossWork,
      labCost,
      netAfterLab,
      doctorShare: netAfterLab,
      clinicShare: 0,
      formulaDescription: 'سهم خالص مدیر کلینیک = کل کارکرد منهای هزینه لابراتوار (۱۰۰٪ خالص مطب)',
    };
  }

  let doctorShare = 0;
  let formulaDescription = '';

  if (input.mode === 'net_half_after_lab') {
    doctorShare = Math.round(netAfterLab / 2);
    formulaDescription = '(کل کارکرد − هزینه لابراتوار) ÷ ۲';
  } else if (input.mode === 'fixed') {
    doctorShare = Math.round(val * count);
    formulaDescription = `مبلغ ثابت ${val.toLocaleString('fa-IR')} تومان × ${count.toLocaleString('fa-IR')} درمان/جراحی`;
  } else {
    const base = input.deductLabInPercentageMode ? netAfterLab : grossWork;
    const clampedPct = Math.min(100, val);
    doctorShare = Math.round((base * clampedPct) / 100);
    formulaDescription = input.deductLabInPercentageMode
      ? `${clampedPct.toLocaleString('fa-IR')}٪ از خالص پس از کسر لابراتوار`
      : `${clampedPct.toLocaleString('fa-IR')}٪ از کل کارکرد ناخالص`;
  }

  const clinicShare = Math.max(0, netAfterLab - doctorShare);

  return {
    mode: input.mode,
    modeLabel: SHARE_MODE_LABELS[input.mode],
    grossWork,
    labCost,
    netAfterLab,
    doctorShare,
    clinicShare,
    formulaDescription,
  };
}
