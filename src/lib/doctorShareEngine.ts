/**
 * MinaDental 3-Mode Work-Based Doctor Share, Implant Fixture & Owner Net Engine
 * Trace ID: TRC-MINA-QBANK-9008-H
 *
 * Core Clinic Rules:
 * - Strictly work-based (`grossWorkAmount` from treatments − `labCostAmount` from lab).
 * - Completely independent of patient payment instruments (guarantee cheques, safteh,
 *   installments, patient debt, or clinic expenses).
 * - Implant Fixture Rule: `implantFixtureCost` is 100% borne by the Clinic (مطب) and
 *   is NEVER deducted from the doctor's share.
 * - Modes:
 *   1. `net_half_after_lab`: (Gross Work − Total Lab Cost) ÷ 2
 *   2. `fixed`: Manual fixed fee per surgery/treatment × count
 *   3. `percentage`: Custom percentage per doctor (with optional lab deduction)
 * - Clinic Owner / Manager / Lead Dentist (`دکتر مهدی امیری`): 100% unrestricted access;
 *   net owner profit = (Gross Work − Lab Cost − Clinic Fixture Cost).
 */

export type DoctorShareMode = 'net_half_after_lab' | 'fixed' | 'percentage';

export interface DoctorShareCalculationInput {
  mode: DoctorShareMode;
  grossWorkAmount: number;
  labCostAmount: number;
  /** Implant fixture cost paid 100% by the clinic (NEVER deducted from doctor share) */
  implantFixtureCost?: number;
  /** Percentage (0–100) for 'percentage', or fixed fee per procedure for 'fixed' */
  shareValue: number;
  /** Number of surgeries/treatments for fixed mode (defaults to 1) */
  procedureCount?: number;
  /** If true in percentage mode, lab cost is deducted before applying doctor percentage */
  deductLabInPercentageMode?: boolean;
  /** If true, calculates Clinic Owner / Manager / Lead Dentist (دکتر مهدی امیری) net */
  isClinicManager?: boolean;
}

export interface DoctorShareCalculationResult {
  mode: DoctorShareMode;
  modeLabel: string;
  grossWork: number;
  labCost: number;
  implantFixtureCostByClinic: number;
  netAfterLab: number;
  doctorShare: number;
  clinicShare: number;
  independentOfChequesAndDebt: true;
  formulaDescription: string;
}

export const SHARE_MODE_LABELS: Record<DoctorShareMode, string> = {
  net_half_after_lab: 'نصف خالص کارکرد پس از کسر لابراتوار ((کارکرد − لابراتوار) ÷ ۲)',
  fixed: 'دستمزد ثابت هر درمان / جراحی',
  percentage: 'درصدی اختصاصی پزشک',
};

export function calculateDoctorShare(input: DoctorShareCalculationInput): DoctorShareCalculationResult {
  const grossWork = Math.max(0, Number(input.grossWorkAmount) || 0);
  const labCost = Math.max(0, Number(input.labCostAmount) || 0);
  const implantFixtureCostByClinic = Math.max(0, Number(input.implantFixtureCost) || 0);
  const netAfterLab = Math.max(0, grossWork - labCost);
  const count = Math.max(1, Number(input.procedureCount) || 1);
  const val = Math.max(0, Number(input.shareValue) || 0);

  // Clinic Owner / Manager / Lead Dentist (دکتر مهدی امیری) — 100% owner net after lab & clinic fixture
  if (input.isClinicManager) {
    const ownerNet = Math.max(0, netAfterLab - implantFixtureCostByClinic);
    return {
      mode: input.mode,
      modeLabel: 'مدیر، پزشک و صاحب مطب (دکتر مهدی امیری — دسترسی ۱۰۰٪)',
      grossWork,
      labCost,
      implantFixtureCostByClinic,
      netAfterLab,
      doctorShare: ownerNet,
      clinicShare: 0,
      independentOfChequesAndDebt: true,
      formulaDescription:
        implantFixtureCostByClinic > 0
          ? 'سهم خالص صاحب مطب = کل کارکرد − هزینه لابراتوار − هزینه فیکسچر ایمپلنت (۱۰۰٪ خالص مطب)'
          : 'سهم خالص صاحب مطب = کل کارکرد − هزینه لابراتوار (۱۰۰٪ خالص مطب)',
    };
  }

  let doctorShare = 0;
  let formulaDescription = '';

  if (input.mode === 'net_half_after_lab') {
    // Fixture is paid by clinic, NEVER deducted from doctor's half!
    doctorShare = Math.round(netAfterLab / 2);
    formulaDescription =
      implantFixtureCostByClinic > 0
        ? '(کل کارکرد − هزینه لابراتوار) ÷ ۲ • هزینه فیکسچر ایمپلنت ۱۰۰٪ به عهده مطب (بدون کسر از پزشک)'
        : '(کل کارکرد − هزینه لابراتوار) ÷ ۲ • مستقل از چک ضمانت، اقساط و بدهی بیمار';
  } else if (input.mode === 'fixed') {
    doctorShare = Math.round(val * count);
    formulaDescription = `مبلغ ثابت ${val.toLocaleString('fa-IR')} تومان × ${count.toLocaleString('fa-IR')} درمان/جراحی (فیکسچر با مطب)`;
  } else {
    const base = input.deductLabInPercentageMode ? netAfterLab : grossWork;
    const clampedPct = Math.min(100, val);
    doctorShare = Math.round((base * clampedPct) / 100);
    formulaDescription = input.deductLabInPercentageMode
      ? `${clampedPct.toLocaleString('fa-IR')}٪ از خالص پس از کسر لابراتوار (فیکسچر با مطب)`
      : `${clampedPct.toLocaleString('fa-IR')}٪ از کل کارکرد ناخالص (فیکسچر با مطب)`;
  }

  // Clinic bears 100% of implant fixture cost out of clinic share
  const clinicShare = Math.max(0, netAfterLab - doctorShare - implantFixtureCostByClinic);

  return {
    mode: input.mode,
    modeLabel: SHARE_MODE_LABELS[input.mode],
    grossWork,
    labCost,
    implantFixtureCostByClinic,
    netAfterLab,
    doctorShare,
    clinicShare,
    independentOfChequesAndDebt: true,
    formulaDescription,
  };
}
