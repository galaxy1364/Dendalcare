import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CURRENCY_CONTRACT,
  convertTomanToRialExact,
  normalizeLocalizedDigits,
  parseExactTomanAmount,
} from '../src/features/finance/monetaryPrecision';
import {
  buildStableFinanceReminderPayload,
  computeClinicCashAndOperatingMetrics,
  computeClinicReceivablesSummary,
  computePatientFinancialLedger,
  computeReceivablesAgingBuckets,
  detectFinancialAnomalies,
  evaluateDailyCloseReconciliation,
  prioritizeAccountsReceivable,
} from '../src/features/finance/financialLedgerEngine';
import {
  clearOrBounceInstrumentCommand,
  computeDeterministicTreatmentAllocations,
  getQueuedFinanceDrafts,
  postPatientPaymentCommand,
  replayQueuedFinanceCommands,
  resetFinanceCommandRuntimeForTest,
  reverseOrRefundPaymentCommand,
  submitDayCloseCommand,
} from '../src/features/finance/financialCommandService';
import { calculateDoctorShare } from '../src/lib/doctorShareEngine';
import { computeDashboardMetrics } from '../src/features/dashboard/dashboard.metrics';
import type {
  Check,
  FinanceTransaction,
  Installment,
  Patient,
  Payment,
  Safteh,
  Treatment,
} from '../src/lib/supabase';

export interface V16TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runCase(
  results: V16TestResult[],
  name: string,
  fn: () => Promise<void> | void
): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
  } catch (err) {
    results.push({
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function makePatient(id = 'pat-1'): Patient {
  return {
    id,
    tenant_id: 'minadental_clinic',
    branch_id: 'main',
    first_name: 'سارا',
    last_name: 'کاظمی',
    national_id: null,
    phone: '09120001122',
    email: null,
    address: null,
    birth_date: null,
    gender: 'female',
    blood_type: null,
    allergies: null,
    medical_history: null,
    medications: null,
    insurance_provider: null,
    insurance_number: null,
    notes: null,
    photo_url: null,
    status: 'active',
    created_at: '2026-01-01T08:00:00Z',
    updated_at: '2026-01-01T08:00:00Z',
  };
}

function makeTreatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 'tr-1',
    tenant_id: 'minadental_clinic',
    branch_id: 'main',
    patient_id: 'pat-1',
    appointment_id: null,
    diagnosis: 'عصب‌کشی دندان ۶',
    treatment_plan: null,
    tooth_numbers: '16',
    status: 'completed',
    total_cost: 1_000_000,
    paid_amount: 0,
    doctor_cost: 0,
    lab_cost: 0,
    material_cost: 0,
    other_cost: 0,
    discount: 0,
    notes: null,
    performed_at: '2026-11-26',
    completed_at: '2026-11-26',
    cancelled_at: null,
    created_at: '2026-11-26T09:00:00Z',
    updated_at: '2026-11-26T09:00:00Z',
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    tenant_id: 'minadental_clinic',
    branch_id: 'main',
    patient_id: 'pat-1',
    treatment_id: null,
    amount: 500_000,
    payment_method: 'card',
    payment_date: '2026-11-26',
    description: 'پرداخت بیمار',
    status: 'completed',
    refunded_at: null,
    voided_at: null,
    reversed_payment_id: null,
    created_at: '2026-11-26T10:00:00Z',
    updated_at: '2026-11-26T10:00:00Z',
    ...overrides,
  };
}

function makeCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: 'chk-1',
    tenant_id: 'minadental_clinic',
    branch_id: 'main',
    patient_id: 'pat-1',
    installment_id: null,
    treatment_id: null,
    check_number: '100200',
    bank_name: 'ملت',
    amount: 500_000,
    issue_date: '2026-11-20',
    due_date: '2026-12-10',
    status: 'pending',
    type: 'collectible',
    is_guarantee: false,
    notes: null,
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:00:00Z',
    ...overrides,
  };
}

function makeFakeRpcClient(handlers: {
  rpc?: (fn: string, args: any) => Promise<any>;
  update?: (table: string, payload: any) => Promise<any>;
}) {
  return {
    rpc: (fn: string, args: any) =>
      handlers.rpc
        ? handlers.rpc(fn, args)
        : Promise.resolve({ data: { ok: true, affectedRows: 1, paymentId: 'pay-srv-1' }, error: null }),
    from: (table: string) => ({
      update: (payload: any) => ({
        eq: () => ({
          select: () =>
            handlers.update
              ? handlers.update(table, payload)
              : Promise.resolve({ data: [{ id: '1', ...payload }], error: null }),
        }),
      }),
    }),
  } as any;
}

export async function runAllV16FinancialIntelligenceTests(): Promise<V16TestResult[]> {
  const results: V16TestResult[] = [];
  resetFinanceCommandRuntimeForTest();

  // FIN-01: Single Monetary Unit Enforcement & Localized Digit Parsing
  await runCase(results, 'FIN-01: IRR_TOMAN localized Persian/Arabic digits, zero float drift, strict invalid rejection', () => {
    assert.equal(CURRENCY_CONTRACT, 'IRR_TOMAN');
    assert.equal(normalizeLocalizedDigits('۵۰۰٬۰۰۰'), '500000');
    const p1 = parseExactTomanAmount('۱,۲۵۰,۰۰۰');
    assert.equal(p1.ok, true);
    if (p1.ok) assert.equal(p1.amount, 1_250_000);

    const pArabic = parseExactTomanAmount('٣٥٠٬٠٠٠');
    assert.equal(pArabic.ok, true);
    if (pArabic.ok) assert.equal(pArabic.amount, 350_000);

    const frac = parseExactTomanAmount('12.5');
    assert.equal(frac.ok, false);
    if (!frac.ok) assert.equal(frac.errorCode, 'NON_INTEGER_FRACTION');

    const persianFrac = parseExactTomanAmount('۱۲٫۵');
    assert.equal(persianFrac.ok, false);
    if (!persianFrac.ok) assert.equal(persianFrac.errorCode, 'NON_INTEGER_FRACTION');

    const neg = parseExactTomanAmount('-۵۰۰۰');
    assert.equal(neg.ok, false);

    const zero = parseExactTomanAmount('۰');
    assert.equal(zero.ok, false);

    assert.equal(convertTomanToRialExact(1_500_000), '15000000');
  });

  // FIN-02: Treatment Plan Estimate Separation
  await runCase(results, 'FIN-02: Planned treatment estimates are excluded from confirmed receivables and debt', () => {
    const patient = makePatient('pat-2');
    const ledger = computePatientFinancialLedger({
      patient,
      treatments: [makeTreatment({ id: 'tr-plan', patient_id: 'pat-2', status: 'planned', total_cost: 2_500_000 })],
      payments: [],
      installments: [],
      checks: [],
      safteh: [],
    });
    assert.equal(ledger.plannedTreatmentValue, 2_500_000);
    assert.equal(ledger.postedChargesTotal, 0);
    assert.equal(ledger.totalRemainingDebt, 0);
  });

  // FIN-03: No Math.max Double-Counting Elimination
  await runCase(results, 'FIN-03: Eliminates Math.max(directPaid, payments) so refunds restore owed debt accurately', () => {
    const patient = makePatient('pat-3');
    const tr = makeTreatment({ id: 'tr-3', patient_id: 'pat-3', total_cost: 1_000_000, paid_amount: 1_000_000 });
    const pay = makePayment({ id: 'p-orig', patient_id: 'pat-3', amount: 1_000_000, status: 'completed' });
    const refund = makePayment({
      id: 'p-ref',
      patient_id: 'pat-3',
      amount: 1_000_000,
      status: 'refunded',
      refunded_at: '2026-11-26',
      reversed_payment_id: 'p-orig',
    });
    const ledger = computePatientFinancialLedger({
      patient,
      treatments: [tr],
      payments: [pay, refund],
      installments: [],
      checks: [],
      safteh: [],
    });
    assert.equal(ledger.netPaidTotal, 0);
    assert.equal(ledger.totalRemainingDebt, 1_000_000);
  });

  // FIN-04: Guarantee Check Isolation
  await runCase(results, 'FIN-04: Guarantee check & safteh held in collateral without inflating collectible checks or cash', async () => {
    const patient = makePatient('pat-4');
    const guaranteeChk = makeCheck({ id: 'chk-g', patient_id: 'pat-4', amount: 10_000_000, is_guarantee: true, type: 'guarantee' });
    const collectibleChk = makeCheck({ id: 'chk-c', patient_id: 'pat-4', amount: 400_000, is_guarantee: false, type: 'collectible' });
    const tr = makeTreatment({ id: 'tr-4', patient_id: 'pat-4', total_cost: 1_000_000 });
    const ledger = computePatientFinancialLedger({
      patient,
      treatments: [tr],
      payments: [],
      installments: [],
      checks: [guaranteeChk, collectibleChk],
      safteh: [],
    });
    assert.equal(ledger.guaranteeChecksAmount, 10_000_000);
    assert.equal(ledger.collectiblePendingChecksAmount, 400_000);
    assert.equal(ledger.uncoveredDebt, 600_000);

    // Clearing a guarantee check must NOT invoke postPatientPaymentCommand to create fake cash income
    let rpcCalled = false;
    const client = makeFakeRpcClient({
      rpc: async () => {
        rpcCalled = true;
        return { data: { ok: true, affectedRows: 1 }, error: null };
      },
    });
    const clr = await clearOrBounceInstrumentCommand(
      {
        kind: 'check',
        record: guaranteeChk,
        nextStatus: 'cleared',
        actorContext: { localRole: 'manager', serverVerifiedRole: 'manager', sessionStatus: 'authenticated' },
      },
      client
    );
    assert.equal(clr.ok, true);
    assert.equal(rpcCalled, false);
  });

  // FIN-05: Installment Plan Without Debt Double-Counting
  await runCase(results, 'FIN-05: Installment plan linked to treatment never doubles patient debt (600k remains 600k)', () => {
    const patient = makePatient('pat-5');
    const tr = makeTreatment({ id: 'tr-5', patient_id: 'pat-5', total_cost: 600_000 });
    const inst: Installment = {
      id: 'ins-5',
      tenant_id: 'minadental_clinic',
      branch_id: 'main',
      patient_id: 'pat-5',
      treatment_id: 'tr-5',
      total_amount: 600_000,
      paid_amount: 0,
      monthly_amount: 200_000,
      total_months: 3,
      paid_months: 0,
      start_date: '2026-11-01',
      next_due_date: '2026-12-01',
      status: 'active',
      notes: null,
      created_at: '2026-11-01T08:00:00Z',
      updated_at: '2026-11-01T08:00:00Z',
    };
    const ledger = computePatientFinancialLedger({
      patient,
      treatments: [tr],
      payments: [],
      installments: [inst],
      checks: [],
      safteh: [],
    });
    assert.equal(ledger.totalRemainingDebt, 600_000);
    assert.equal(ledger.uncoveredDebt, 0);
  });

  // FIN-06: Payment Allocation & Unapplied Credit Handling
  await runCase(results, 'FIN-06: Overpayment allocates up to posted charges and preserves remainder as unappliedCredit', () => {
    const patient = makePatient('pat-6');
    const tr = makeTreatment({ id: 'tr-6', patient_id: 'pat-6', total_cost: 1_000_000 });
    const pay = makePayment({ id: 'p-6', patient_id: 'pat-6', amount: 1_500_000 });
    const ledger = computePatientFinancialLedger({
      patient,
      treatments: [tr],
      payments: [pay],
      installments: [],
      checks: [],
      safteh: [],
    });
    assert.equal(ledger.allocatedPaidTotal, 1_000_000);
    assert.equal(ledger.totalRemainingDebt, 0);
    assert.equal(ledger.unappliedCredit, 500_000);

    const allocPlan = computeDeterministicTreatmentAllocations(1_500_000, [tr]);
    assert.equal(allocPlan.allocations[0].amount, 1_000_000);
    assert.equal(allocPlan.unappliedCreditToman, 500_000);
  });

  // FIN-07: Refund & Reversal Across Periods
  await runCase(results, 'FIN-07: Cross-period refund leaves prior month gross collections intact and reduces current period net', () => {
    const pPrev = makePayment({ id: 'p-prev', amount: 800_000, payment_date: '2026-11-01', status: 'completed' });
    const pRefCurrent = makePayment({
      id: 'p-curr-ref',
      amount: 300_000,
      payment_date: '2026-11-26',
      status: 'refunded',
      refunded_at: '2026-11-26',
      reversed_payment_id: 'p-prev',
    });
    const prevMetrics = computeClinicCashAndOperatingMetrics({
      tenantId: 'minadental_clinic',
      branchId: 'main',
      treatments: [],
      payments: [pPrev, pRefCurrent],
      finance: [],
      windowStartIso: '2026-10-23',
      windowEndIso: '2026-11-21',
    });
    const currMetrics = computeClinicCashAndOperatingMetrics({
      tenantId: 'minadental_clinic',
      branchId: 'main',
      treatments: [],
      payments: [pPrev, pRefCurrent],
      finance: [],
      windowStartIso: '2026-11-22',
      windowEndIso: '2026-12-21',
    });
    assert.equal(prevMetrics.grossCollections, 800_000);
    assert.equal(currMetrics.periodRefunds, 300_000);
    assert.equal(currMetrics.netCollections, -300_000);
  });

  // FIN-08: Atomic Multi-Table Payment Posting (fail-closed if RPC errors -> no partial writes)
  await runCase(results, 'FIN-08: Payment command fails closed without partial writes on RPC error', async () => {
    const client = makeFakeRpcClient({
      rpc: async () => ({ data: null, error: { message: 'MINA_FIN_DEADLOCK: rollback' } }),
    });
    const res = await postPatientPaymentCommand(
      {
        patientId: 'pat-1',
        amountInput: '450000',
        paymentMethod: 'cash',
        idempotencyKey: 'fin08-atomic',
        actorContext: { localRole: 'secretary', serverVerifiedRole: 'secretary', sessionStatus: 'authenticated' },
      },
      client
    );
    assert.equal(res.resolution, 'rejected');
    assert.equal(res.ok, false);
  });

  // FIN-09: Idempotent Retry & Double-Click Protection
  await runCase(results, 'FIN-09: Same idempotency key returns idempotent replay; modified payload with same key is rejected', async () => {
    resetFinanceCommandRuntimeForTest();
    let rpcCalls = 0;
    const client = makeFakeRpcClient({
      rpc: async () => {
        rpcCalls += 1;
        return { data: { ok: true, affectedRows: 1, paymentId: 'pay-idemp-1', allocatedAmountToman: 500_000, unappliedCreditToman: 0 }, error: null };
      },
    });
    const actor = { userId: 'u-sec', localRole: 'secretary', serverVerifiedRole: 'secretary', sessionStatus: 'authenticated' as const };
    const r1 = await postPatientPaymentCommand(
      { patientId: 'pat-1', amountInput: '500000', paymentMethod: 'card', idempotencyKey: 'idem-key-09', actorContext: actor },
      client
    );
    const r2 = await postPatientPaymentCommand(
      { patientId: 'pat-1', amountInput: '500000', paymentMethod: 'card', idempotencyKey: 'idem-key-09', actorContext: actor },
      client
    );
    const rConflict = await postPatientPaymentCommand(
      { patientId: 'pat-1', amountInput: '900000', paymentMethod: 'card', idempotencyKey: 'idem-key-09', actorContext: actor },
      client
    );
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r2.idempotentReplay, true);
    assert.equal(rpcCalls, 1);
    assert.equal(rConflict.resolution, 'rejected');
    assert.equal(rConflict.errorCode, 'IDEMPOTENCY_PAYLOAD_CONFLICT');
  });

  // FIN-10: Concurrency Lock on Overlapping Same-Key Flight
  await runCase(results, 'FIN-10: Concurrent in-flight same-key submission is blocked instead of posting twice', async () => {
    resetFinanceCommandRuntimeForTest();
    const client = makeFakeRpcClient({
      rpc: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { data: { ok: true, affectedRows: 1, paymentId: 'pay-conc' }, error: null };
      },
    });
    const actor = { userId: 'u-mgr', localRole: 'manager', serverVerifiedRole: 'manager', sessionStatus: 'authenticated' as const };
    const [a, b] = await Promise.all([
      postPatientPaymentCommand({ patientId: 'pat-1', amountInput: '200000', paymentMethod: 'cash', idempotencyKey: 'conc-key', actorContext: actor }, client),
      postPatientPaymentCommand({ patientId: 'pat-1', amountInput: '200000', paymentMethod: 'cash', idempotencyKey: 'conc-key', actorContext: actor }, client),
    ]);
    assert.equal(a.ok || b.ok, true);
    assert.equal(a.errorCode === 'CONCURRENT_IN_FLIGHT_DUPLICATE' || b.errorCode === 'CONCURRENT_IN_FLIGHT_DUPLICATE', true);
  });

  // FIN-11: Posted Record Immutability & SQL Trigger
  await runCase(results, 'FIN-11: SQL migration enforces posted finance_transactions immutability & balanced journal trigger', () => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20261201000000_v16_financial_intelligence_ledger_and_reconciliation.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    assert.ok(sql.includes('prevent_posted_finance_tx_mutation'));
    assert.ok(sql.includes('verify_journal_entry_balanced'));
    assert.ok(sql.includes('MINA_FIN_POSTED_IMMUTABLE'));
  });

  // FIN-12: Closed Business Day Enforcement
  await runCase(results, 'FIN-12: Posting to closed business date is rejected unless manager explicitly reopens', async () => {
    const client = makeFakeRpcClient({});
    const closedAttempt = await postPatientPaymentCommand(
      {
        patientId: 'pat-1',
        amountInput: '100000',
        paymentMethod: 'cash',
        businessDate: '2026-11-25',
        closedBusinessDates: ['2026-11-25'],
        actorContext: { localRole: 'secretary', serverVerifiedRole: 'secretary', sessionStatus: 'authenticated' },
      },
      client
    );
    assert.equal(closedAttempt.resolution, 'rejected');
    assert.equal(closedAttempt.errorCode, 'PERIOD_CLOSED');

    const secReopen = await submitDayCloseCommand(
      {
        businessDate: '2026-11-25',
        openingBalanceInput: '0',
        countedCashInput: '0',
        action: 'reopen',
        exceptionNotes: 'تلاش منشی',
        actorContext: { localRole: 'secretary', serverVerifiedRole: 'secretary', sessionStatus: 'authenticated' },
      },
      client
    );
    assert.equal(secReopen.resolution, 'rejected');
    assert.equal(secReopen.errorCode, 'RBAC_REOPEN_MANAGER_ONLY');

    const mgrReopen = await submitDayCloseCommand(
      {
        businessDate: '2026-11-25',
        openingBalanceInput: '0',
        countedCashInput: '0',
        action: 'reopen',
        exceptionNotes: 'اصلاح سند مغایرت کارتخوان',
        actorContext: { localRole: 'manager', serverVerifiedRole: 'manager', sessionStatus: 'authenticated' },
      },
      client
    );
    assert.equal(mgrReopen.ok, true);
  });

  // FIN-13: Strict RBAC & Revoked Membership Enforcement
  await runCase(results, 'FIN-13: Dentist/assistant/unauthorized blocked from payments; secretary blocked from refunds', async () => {
    const client = makeFakeRpcClient({});
    for (const badRole of ['dentist', 'assistant', 'unauthorized'] as const) {
      const r = await postPatientPaymentCommand(
        {
          patientId: 'pat-1',
          amountInput: '100000',
          paymentMethod: 'cash',
          actorContext: {
            localRole: 'manager',
            serverVerifiedRole: badRole === 'unauthorized' ? null : badRole,
            sessionStatus: badRole === 'unauthorized' ? 'unauthorized' : 'authenticated',
          },
        },
        client
      );
      assert.equal(r.resolution, 'rejected');
      assert.equal(r.errorCode, 'RBAC_PAYMENT_FORBIDDEN');
    }

    const secRefund = await reverseOrRefundPaymentCommand(
      {
        paymentId: 'pay-1',
        originalAmountToman: 500_000,
        refundAmountInput: '100000',
        reason: 'تست',
        actorContext: { localRole: 'secretary', serverVerifiedRole: 'secretary', sessionStatus: 'authenticated' },
      },
      client
    );
    assert.equal(secRefund.resolution, 'rejected');
    assert.equal(secRefund.errorCode, 'RBAC_REFUND_MANAGER_ONLY');
  });

  // FIN-14: Cross-Tenant / Cross-Branch Scope Enforcement
  await runCase(results, 'FIN-14: Foreign tenant or branch records are strictly excluded from clinic operating & receivables KPIs', () => {
    const metrics = computeClinicCashAndOperatingMetrics({
      tenantId: 'minadental_clinic',
      branchId: 'main',
      treatments: [makeTreatment({ id: 'tr-other', branch_id: 'north', total_cost: 9_000_000 })],
      payments: [makePayment({ id: 'pay-other', tenant_id: 'other_clinic', amount: 5_000_000 })],
      finance: [],
      referenceDateIso: '2026-11-26',
    });
    assert.equal(metrics.grossCollections, 0);
    assert.equal(metrics.netClinicalProduction, 0);
  });

  // FIN-15: Doctor Share Engine 3-Mode Accuracy & Implant Fixture Rule
  await runCase(results, 'FIN-15: Doctor share 3 modes independent of guarantee checks/debt + 100% clinic fixture cost', () => {
    const half = calculateDoctorShare({ mode: 'net_half_after_lab', grossWorkAmount: 10_000_000, labCostAmount: 2_000_000, implantFixtureCost: 3_000_000, shareValue: 50 });
    assert.equal(half.doctorShare, 4_000_000);
    assert.equal(half.clinicShare, 1_000_000);

    const fixed = calculateDoctorShare({ mode: 'fixed', grossWorkAmount: 8_000_000, labCostAmount: 0, shareValue: 1_500_000, procedureCount: 2 });
    assert.equal(fixed.doctorShare, 3_000_000);

    const pct = calculateDoctorShare({ mode: 'percentage', grossWorkAmount: 10_000_000, labCostAmount: 2_000_000, shareValue: 60, deductLabInPercentageMode: true });
    assert.equal(pct.doctorShare, 4_800_000);

    const mgr = calculateDoctorShare({ mode: 'percentage', grossWorkAmount: 10_000_000, labCostAmount: 2_000_000, implantFixtureCost: 1_500_000, shareValue: 100, isClinicManager: true });
    assert.equal(mgr.doctorShare, 6_500_000);
  });

  // FIN-16: Aging by Contractual Due Date
  await runCase(results, 'FIN-16: Receivables aging uses contractual due dates (never patient registration created_at)', () => {
    const patOldCreated = makePatient('pat-16'); // created_at 2026-01-01 (>300 days ago)
    const ledger = computePatientFinancialLedger({
      patient: patOldCreated,
      treatments: [makeTreatment({ id: 'tr-16', patient_id: 'pat-16', total_cost: 700_000 })],
      payments: [],
      installments: [],
      checks: [makeCheck({ id: 'chk-16', patient_id: 'pat-16', amount: 700_000, due_date: '2026-11-10' })], // 16 days overdue from 2026-11-26
      safteh: [],
      referenceDateIso: '2026-11-26',
    });
    const aging = computeReceivablesAgingBuckets([ledger], '2026-11-26');
    assert.equal(aging.days_1_30, 700_000);
    assert.equal(aging.over_90, 0);
  });

  // FIN-17: Internal Transfer Exclusion
  await runCase(results, 'FIN-17: Internal transfers between clinic accounts are excluded from revenue & operating expense', () => {
    const transferTx: FinanceTransaction = {
      id: 'tx-xfer',
      tenant_id: 'minadental_clinic',
      branch_id: 'main',
      type: 'transfer',
      category: 'other',
      amount: 4_000_000,
      transaction_date: '2026-11-26',
      description: 'انتقال از صندوق به بانک',
      patient_id: null,
      payment_method: 'transfer',
      reference: null,
      created_at: '2026-11-26T12:00:00Z',
      updated_at: '2026-11-26T12:00:00Z',
    };
    const metrics = computeClinicCashAndOperatingMetrics({
      tenantId: 'minadental_clinic',
      branchId: 'main',
      treatments: [],
      payments: [],
      finance: [transferTx],
      referenceDateIso: '2026-11-26',
    });
    assert.equal(metrics.internalTransfersTotal, 4_000_000);
    assert.equal(metrics.extraNonPatientIncome, 0);
    assert.equal(metrics.cashExpensesTotal, 0);
    assert.equal(metrics.netCashFlow, 0);
  });

  // FIN-18: Cross-Screen Consistency (Dashboard vs Finance vs PatientDetail)
  await runCase(results, 'FIN-18: Dashboard, Finance ledger & PatientDetail compute matching collections and receivables', () => {
    const patient = makePatient('pat-18');
    const tr = makeTreatment({ id: 'tr-18', patient_id: 'pat-18', total_cost: 2_000_000, paid_amount: 500_000 });
    const pay = makePayment({ id: 'pay-18', patient_id: 'pat-18', amount: 500_000, payment_date: '2026-11-26' });
    const ledger = computePatientFinancialLedger({
      patient,
      treatments: [tr],
      payments: [pay],
      installments: [],
      checks: [],
      safteh: [],
      referenceDateIso: '2026-11-26',
    });
    const recSummary = computeClinicReceivablesSummary([ledger], '2026-11-26');
    const dash = computeDashboardMetrics({
      patients: [patient],
      appointments: [],
      treatments: [tr],
      labOrders: [],
      implants: [],
      payments: [pay],
      inventory: [],
      reminders: [],
      finance: [],
      installments: [],
      checks: [],
      safteh: [],
      clinicSettings: [],
      staff: [],
      units: [],
      branchId: 'main',
      tenantId: 'minadental_clinic',
      userRole: 'manager',
      referenceDateIso: '2026-11-26',
    });
    assert.equal(recSummary.totalReceivables, 1_500_000);
    assert.equal(dash.revenue.totalReceivables, 1_500_000);
    assert.equal(dash.revenue.todayCollected, 500_000);
  });

  // FIN-19: Pagination / Partial Fetch Completeness Guard
  await runCase(results, 'FIN-19: Financial metrics mark dataCompleteness partial_or_truncated when pageLimit reached', () => {
    const metrics = computeClinicCashAndOperatingMetrics({
      tenantId: 'minadental_clinic',
      branchId: 'main',
      treatments: [],
      payments: [makePayment({ id: 'p-lim-1' }), makePayment({ id: 'p-lim-2' })],
      finance: [],
      referenceDateIso: '2026-11-26',
      pageLimit: 2,
    });
    assert.equal(metrics.provenance.dataCompleteness, 'partial_or_truncated');
    assert.equal(metrics.provenance.isProvisional, true);
  });

  // FIN-20: Offline Financial Queue Isolation & Revoke-Safe Replay
  await runCase(results, 'FIN-20: Offline queued draft stays outside confirmed cash and replay blocks revoked sessions', async () => {
    resetFinanceCommandRuntimeForTest();
    const offlineClient = makeFakeRpcClient({
      rpc: async () => ({ data: null, error: { message: 'Failed to fetch' } }),
    });
    const queued = await postPatientPaymentCommand(
      {
        patientId: 'pat-1',
        amountInput: '300000',
        paymentMethod: 'cash',
        idempotencyKey: 'offline-20',
        actorContext: { localRole: 'secretary', serverVerifiedRole: 'secretary', sessionStatus: 'authenticated' },
      },
      offlineClient
    );
    assert.equal(queued.resolution, 'queued');
    assert.equal(queued.ok, false);
    assert.equal(getQueuedFinanceDrafts().length, 1);

    const revokedReplay = await replayQueuedFinanceCommands(
      { localRole: 'manager', serverVerifiedRole: null, sessionStatus: 'unauthorized' },
      makeFakeRpcClient({})
    );
    assert.equal(revokedReplay.replayed, 0);
    assert.equal(revokedReplay.errorCode, 'UNAUTHORIZED_MEMBERSHIP_REPLAY_BLOCKED');

    const activeReplay = await replayQueuedFinanceCommands(
      { localRole: 'secretary', serverVerifiedRole: 'secretary', sessionStatus: 'authenticated' },
      makeFakeRpcClient({})
    );
    assert.equal(activeReplay.replayed, 1);
    assert.equal(getQueuedFinanceDrafts().length, 0);
  });

  // FIN-21: Financial Reminder Loop & Privacy Check
  await runCase(results, 'FIN-21: Deterministic stable sourceKey prevents duplicate reminders and omits PHI/debt from lock screen', () => {
    const pat = makePatient('pat-21');
    const r1 = buildStableFinanceReminderPayload({
      kind: 'check_due',
      entityId: 'chk-99',
      patient: pat,
      targetDateIso: '2026-12-05',
      leadDaysBefore: 3,
      amountToman: 4_200_000,
      todayIso: '2026-11-26',
    });
    const r2 = buildStableFinanceReminderPayload({
      kind: 'check_due',
      entityId: 'chk-99',
      patient: pat,
      targetDateIso: '2026-12-05',
      leadDaysBefore: 3,
      amountToman: 4_200_000,
      todayIso: '2026-11-26',
    });
    assert.equal(r1.sourceKey, r2.sourceKey);
    assert.equal(r1.lockScreenSafeTitle.includes('4,200,000'), false);
    assert.equal(r1.lockScreenSafeTitle.includes('۴٬۲۰۰٬۰۰۰'), false);
    assert.equal(r1.lockScreenSafeTitle.includes('سارا'), false);
  });

  // FIN-22: Zero-Row Mutation Rejection
  await runCase(results, 'FIN-22: Zero-affected-rows RPC response never emits confirmed success', async () => {
    resetFinanceCommandRuntimeForTest();
    const zeroRowClient = makeFakeRpcClient({
      rpc: async () => ({ data: [], count: 0, affectedRows: 0, error: null }),
    });
    const res = await postPatientPaymentCommand(
      {
        patientId: 'pat-1',
        amountInput: '250000',
        paymentMethod: 'card',
        idempotencyKey: 'fin22-zero',
        actorContext: { localRole: 'manager', serverVerifiedRole: 'manager', sessionStatus: 'authenticated' },
      },
      zeroRowClient
    );
    assert.notEqual(res.resolution, 'confirmed');
    assert.equal(res.ok, false);
  });

  // FIN-23: Daily Close Reconciliation & Variance Blocking
  await runCase(results, 'FIN-23: Daily close detects cash drawer variance and prevents silent balanced close', () => {
    const closeEval = evaluateDailyCloseReconciliation({
      businessDate: '2026-11-26',
      openingBalance: 1_000_000,
      countedCash: 1_450_000,
      payments: [
        makePayment({ id: 'p-cash', amount: 500_000, payment_method: 'cash', payment_date: '2026-11-26' }),
        makePayment({ id: 'p-card', amount: 900_000, payment_method: 'card', payment_date: '2026-11-26' }),
      ],
    });
    assert.equal(closeEval.expectedDrawerCash, 1_500_000);
    assert.equal(closeEval.varianceAmount, -50_000);
    assert.equal(closeEval.hasVariance, true);
    assert.equal(closeEval.canCloseSilently, false);
    assert.equal(closeEval.requiresVarianceExplanation, true);
  });

  // FIN-24: Anomaly & Explainable AR Prioritization
  await runCase(results, 'FIN-24: Duplicate receipt & unlinked treasury tx flagged + explainable AR priority score', () => {
    const anomalies = detectFinancialAnomalies({
      payments: [
        makePayment({ id: 'p-dup-1', amount: 500_000, payment_date: '2026-11-26', payment_method: 'card' }),
        makePayment({ id: 'p-dup-2', amount: 500_000, payment_date: '2026-11-26', payment_method: 'card' }),
      ],
      finance: [
        {
          id: 'tx-unlinked',
          tenant_id: 'minadental_clinic',
          branch_id: 'main',
          type: 'income',
          category: 'patient_payment',
          amount: 500_000,
          transaction_date: '2026-11-26',
          description: 'واریز بدون مرجع',
          patient_id: 'pat-1',
          payment_method: 'card',
          reference: null,
          created_at: '2026-11-26T10:00:00Z',
          updated_at: '2026-11-26T10:00:00Z',
        },
      ],
      checks: [makeCheck({ id: 'chk-stale', due_date: '2026-11-01', amount: 300_000 })],
      treatments: [makeTreatment({ id: 'tr-nodate', performed_at: null, completed_at: null })],
      referenceDateIso: '2026-11-26',
    });
    assert.ok(anomalies.some((a) => a.ruleCode === 'DUPLICATE_RECEIPT_CANDIDATE'));
    assert.ok(anomalies.some((a) => a.ruleCode === 'UNLINKED_PATIENT_PAYMENT_TX'));
    assert.ok(anomalies.some((a) => a.ruleCode === 'STALE_PENDING_CHECK'));
    assert.ok(anomalies.some((a) => a.ruleCode === 'MISSING_PERFORMED_DATE'));

    const pat = makePatient('pat-24');
    const ledger = computePatientFinancialLedger({
      patient: pat,
      treatments: [makeTreatment({ id: 'tr-24', patient_id: 'pat-24', total_cost: 2_000_000 })],
      payments: [],
      installments: [],
      checks: [makeCheck({ id: 'chk-bounced', patient_id: 'pat-24', status: 'bounced', due_date: '2026-11-15' })],
      safteh: [],
      referenceDateIso: '2026-11-26',
    });
    const priorities = prioritizeAccountsReceivable([ledger]);
    assert.equal(priorities.length, 1);
    assert.equal(priorities[0].urgentCareProtected, true);
    assert.ok(priorities[0].reasonsFa.some((r) => r.includes('چک برگشتی')));
  });

  // FIN-25: Modular Architecture Line-Budget Enforcement
  await runCase(results, 'FIN-25: Finance.tsx and all /src/features/finance/*.ts(x) + Patient finance tabs stay <= 500 lines', () => {
    const finDir = path.resolve(process.cwd(), 'src/features/finance');
    const finFiles = fs
      .readdirSync(finDir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .map((f) => `src/features/finance/${f}`);
    const filesToCheck = [
      'src/components/sections/Finance.tsx',
      ...finFiles,
      'src/features/patients/PatientFinanceAndSpecialtyTabs.tsx',
      'src/features/patients/PatientDetailHub.tsx',
    ];
    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      const lines = content.split(/\r?\n/).length;
      assert.ok(lines <= 500, `Expected ${rel} <= 500 lines, got ${lines}`);
    }
  });

  return results;
}
