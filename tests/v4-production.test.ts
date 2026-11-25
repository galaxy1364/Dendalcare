import assert from 'node:assert/strict';
import {
  computeDashboardMetrics,
  computeRealChairCapacity,
  isDuplicatePaymentTransaction,
  isGuaranteeCheck,
  isLinkedTreatmentDirectCostExpense,
  matchesTenantAndBranch,
  resolveTreatmentRealizationDate,
  toBaseIntMoney,
} from '@/features/dashboard/dashboard.metrics';
import {
  DASHBOARD_SELECTS,
  evaluateDashboardSourceStatuses,
  isValidDashboardServerSummary,
} from '@/features/dashboard/dashboard.service';
import type { DashboardServerSummary, DashboardSourceKey } from '@/features/dashboard/dashboard.types';
import {
  isSchemaMigrationRequiredError,
  reconcileServerRows,
  shouldAcceptTableResponse,
  type TableDataStatus,
} from '@/lib/useRealtimeTable';
import {
  VAULT_CRYPTO_VERSION,
  clearAllSessionVaultKeys,
  decryptVaultPayload,
  encryptVaultPayload,
  generateRandomHex,
  getVaultMirrorKey,
} from '@/lib/dataVault';
import { buildRouteHashUrl, parseRouteFromUrl } from '@/navigation/urlRouter';
import { buildQBankNotchPath } from '@/components/ui/QBankTile';
import { canAccessRoute, canPerformAction, resolveEffectiveRole } from '@/services/permissions/accessControl';
import type {
  Appointment,
  Check,
  ClinicSetting,
  FinanceTransaction,
  Payment,
  Staff,
  Treatment,
} from '@/lib/supabase';

const TENANT = 'minadental_clinic';
const BRANCH = 'main';
const REF_TODAY = '2025-06-15'; // 1404/03/25 (Khordad 1404: 2025-05-22 .. 2025-06-21)

function makeBaseInput(overrides: Partial<Parameters<typeof computeDashboardMetrics>[0]> = {}) {
  return {
    patients: [],
    appointments: [],
    treatments: [],
    labOrders: [],
    implants: [],
    payments: [],
    inventory: [],
    reminders: [],
    finance: [],
    installments: [],
    checks: [],
    safteh: [],
    clinicSettings: [],
    staff: [],
    units: [],
    branchId: BRANCH,
    tenantId: TENANT,
    userRole: 'manager' as const,
    referenceDateIso: REF_TODAY,
    financialDataComplete: true,
    ...overrides,
  };
}

function makeAllReadyStatuses(
  overrides: Partial<Record<DashboardSourceKey, TableDataStatus>> = {}
): Record<DashboardSourceKey, TableDataStatus> {
  return {
    patients: 'ready',
    appointments: 'ready',
    treatments: 'ready',
    lab_orders: 'ready',
    implants: 'ready',
    payments: 'ready',
    inventory: 'ready',
    reminders: 'ready',
    finance_transactions: 'ready',
    installments: 'ready',
    checks: 'ready',
    safteh: 'ready',
    clinic_settings: 'ready',
    staff: 'ready',
    ...overrides,
  };
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  error?: string;
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [
  {
    name: 'P0-01: >500-record dataset (650 treatments + 650 payments) matches exact independent sum with zero truncation',
    fn: () => {
      const treatments: Treatment[] = [];
      const payments: Payment[] = [];
      let expectedProd = 0;
      let expectedDirect = 0;
      let expectedCollected = 0;

      for (let i = 0; i < 650; i++) {
        const cost = 1_000_000 + (i % 7) * 50_000;
        const discount = (i % 3) * 10_000;
        const labCost = 120_000;
        const docCost = 200_000;
        expectedProd += cost - discount;
        expectedDirect += labCost + docCost;

        treatments.push({
          id: `t_${i}`,
          tenant_id: TENANT,
          branch_id: BRANCH,
          patient_id: `p_${i}`,
          status: 'completed',
          total_cost: cost,
          discount,
          paid_amount: cost - discount,
          doctor_cost: docCost,
          lab_cost: labCost,
          material_cost: 0,
          other_cost: 0,
          performed_at: '2025-06-10T10:00:00Z',
          completed_at: '2025-06-10T10:00:00Z',
          created_at: '2025-05-01T08:00:00Z',
        } as Treatment);

        const payAmt = 800_000 + (i % 5) * 25_000;
        expectedCollected += payAmt;
        payments.push({
          id: `pay_${i}`,
          tenant_id: TENANT,
          branch_id: BRANCH,
          patient_id: `p_${i}`,
          amount: payAmt,
          payment_date: '2025-06-12',
          status: 'completed',
          created_at: '2025-06-12T11:00:00Z',
        } as Payment);
      }

      const res = computeDashboardMetrics(makeBaseInput({ treatments, payments }));
      assert.equal(res.revenue.currencyUnit, 'IRR_TOMAN');
      assert.equal(res.revenue.monthTreatmentProduction, expectedProd);
      assert.equal(res.revenue.monthDirectCosts, expectedDirect);
      assert.equal(res.revenue.monthCollected, expectedCollected);
      assert.equal(res.revenue.monthNetProfit, expectedProd - expectedDirect);
      assert.equal(res.unverifiedCompletionDateCount, 0);
    },
  },
  {
    name: 'P0-02: Accrual revenue recognizes strictly on performed_at/completed_at (never created_at) and counts unverified completed treatments',
    fn: () => {
      const createdLastMonthPerformedThisMonth = {
        id: 't_ok',
        tenant_id: TENANT,
        branch_id: BRANCH,
        status: 'completed',
        total_cost: 5_000_000,
        discount: 500_000,
        paid_amount: 4_500_000,
        doctor_cost: 1_000_000,
        lab_cost: 500_000,
        material_cost: 0,
        other_cost: 0,
        created_at: '2025-04-10T09:00:00Z', // Previous Jalali month
        performed_at: '2025-06-05T14:00:00Z', // Current Jalali month
      } as Treatment;

      const createdThisMonthNoCompletionDate = {
        id: 't_unverified',
        tenant_id: TENANT,
        branch_id: BRANCH,
        status: 'completed',
        total_cost: 9_000_000,
        discount: 0,
        paid_amount: 0,
        created_at: '2025-06-14T09:00:00Z',
        performed_at: null,
        completed_at: null,
      } as Treatment;

      const performedLastMonth = {
        id: 't_prev_month',
        tenant_id: TENANT,
        branch_id: BRANCH,
        status: 'completed',
        total_cost: 3_000_000,
        discount: 0,
        paid_amount: 3_000_000,
        created_at: '2025-06-14T09:00:00Z',
        completed_at: '2025-05-10T09:00:00Z', // Outside Khordad 1404
      } as Treatment;

      assert.equal(resolveTreatmentRealizationDate(createdLastMonthPerformedThisMonth), '2025-06-05T14:00:00Z');
      assert.equal(resolveTreatmentRealizationDate(createdThisMonthNoCompletionDate), null);

      const res = computeDashboardMetrics(
        makeBaseInput({
          treatments: [
            createdLastMonthPerformedThisMonth,
            createdThisMonthNoCompletionDate,
            performedLastMonth,
          ],
        })
      );

      assert.equal(res.revenue.monthTreatmentProduction, 4_500_000);
      assert.equal(res.revenue.monthDirectCosts, 1_500_000);
      assert.equal(res.revenue.monthNetProfit, 3_000_000);
      assert.equal(res.unverifiedCompletionDateCount, 1);
      assert.equal(res.revenue.unverifiedCompletionDateCount, 1);
    },
  },
  {
    name: 'P0-03: Refunds are deducted from collected cash, voided/cancelled payments are excluded, and duplicate payment_id vs PAY:MANUAL is exact',
    fn: () => {
      const payments: Payment[] = [
        {
          id: 'pay-101',
          tenant_id: TENANT,
          branch_id: BRANCH,
          amount: 4_000_000,
          payment_date: REF_TODAY,
          status: 'completed',
          created_at: '2025-06-15T10:00:00Z',
        } as Payment,
        {
          id: 'pay-refund-1',
          tenant_id: TENANT,
          branch_id: BRANCH,
          amount: 700_000,
          payment_date: '2025-06-10',
          refunded_at: REF_TODAY,
          status: 'refunded',
          created_at: '2025-06-10T10:00:00Z',
        } as Payment,
        {
          id: 'pay-void-1',
          tenant_id: TENANT,
          branch_id: BRANCH,
          amount: 5_000_000,
          payment_date: REF_TODAY,
          voided_at: REF_TODAY,
          status: 'completed',
          created_at: '2025-06-15T11:00:00Z',
        } as Payment,
      ];

      const finance: FinanceTransaction[] = [
        // Exact duplicate of pay-101 -> MUST be deduplicated
        {
          id: 'fin-dup',
          tenant_id: TENANT,
          branch_id: BRANCH,
          payment_id: 'pay-101',
          type: 'income',
          amount: 4_000_000,
          transaction_date: REF_TODAY,
          reference: 'PAY:pay-101',
          created_at: '2025-06-15T10:01:00Z',
        } as FinanceTransaction,
        // Manual income with PAY: prefix that does NOT match any Payment.id -> MUST be preserved
        {
          id: 'fin-manual',
          tenant_id: TENANT,
          branch_id: BRANCH,
          type: 'income',
          amount: 1_200_000,
          transaction_date: REF_TODAY,
          reference: 'PAY:MANUAL-INSURANCE-01',
          created_at: '2025-06-15T12:00:00Z',
        } as FinanceTransaction,
      ];

      assert.equal(isDuplicatePaymentTransaction(finance[0], [payments[0]]), true);
      assert.equal(isDuplicatePaymentTransaction(finance[1], [payments[0]]), false);

      const res = computeDashboardMetrics(makeBaseInput({ payments, finance }));
      assert.equal(res.revenue.todayCollected, 3_300_000);
      assert.equal(res.revenue.monthCollected, 3_300_000);
      assert.equal(res.revenue.monthRefunded, 700_000);
      assert.equal(res.revenue.monthExtraIncome, 1_200_000);
      assert.equal(res.revenue.monthCashFlow, 4_500_000);
    },
  },
  {
    name: 'P0-04: Linked treatment direct-cost expense is deduplicated while clinic rent is preserved; guarantee checks stay isolated from receivables',
    fn: () => {
      const t1 = {
        id: 'treat-55',
        tenant_id: TENANT,
        branch_id: BRANCH,
        status: 'completed',
        total_cost: 6_000_000,
        discount: 0,
        paid_amount: 2_000_000,
        doctor_cost: 1_500_000,
        lab_cost: 800_000,
        material_cost: 0,
        other_cost: 0,
        performed_at: '2025-06-10T10:00:00Z',
        created_at: '2025-06-09T10:00:00Z',
      } as Treatment;

      const linkedExpense = {
        id: 'exp-linked',
        tenant_id: TENANT,
        branch_id: BRANCH,
        treatment_id: 'treat-55',
        type: 'expense',
        amount: 800_000,
        transaction_date: '2025-06-10',
        created_at: '2025-06-10T12:00:00Z',
      } as FinanceTransaction;

      const rentExpense = {
        id: 'exp-rent',
        tenant_id: TENANT,
        branch_id: BRANCH,
        type: 'expense',
        amount: 1_000_000,
        transaction_date: '2025-06-02',
        created_at: '2025-06-02T12:00:00Z',
      } as FinanceTransaction;

      const checks: Check[] = [
        {
          id: 'chk-guarantee',
          tenant_id: TENANT,
          branch_id: BRANCH,
          amount: 15_000_000,
          due_date: '2025-06-20',
          status: 'pending',
          is_guarantee: true,
          created_at: '2025-06-01T10:00:00Z',
        } as Check,
        {
          id: 'chk-collectible',
          tenant_id: TENANT,
          branch_id: BRANCH,
          amount: 2_500_000,
          due_date: '2025-06-25',
          status: 'pending',
          is_guarantee: false,
          created_at: '2025-06-01T10:00:00Z',
        } as Check,
      ];

      assert.equal(isLinkedTreatmentDirectCostExpense(linkedExpense, [t1]), true);
      assert.equal(isLinkedTreatmentDirectCostExpense(rentExpense, [t1]), false);
      assert.equal(isGuaranteeCheck(checks[0]), true);
      assert.equal(isGuaranteeCheck(checks[1]), false);

      const res = computeDashboardMetrics(
        makeBaseInput({ treatments: [t1], finance: [linkedExpense, rentExpense], checks })
      );
      assert.equal(res.revenue.monthDirectCosts, 2_300_000);
      assert.equal(res.revenue.monthExpense, 1_000_000);
      assert.equal(res.revenue.monthNetProfit, 6_000_000 - 2_300_000 - 1_000_000);
      assert.equal(res.revenue.guaranteeChecksPendingAmount, 15_000_000);
      assert.equal(res.revenue.collectionChecksPendingAmount, 2_500_000);
      // Treatment A/R (4M) + standalone collectible check (2.5M) = 6.5M (guarantee 15M excluded)
      assert.equal(res.revenue.totalReceivables, 6_500_000);
    },
  },
  {
    name: 'P0-05: Strict fail-closed tenant & branch isolation rejects missing/empty/mismatched tenant_id or branch_id',
    fn: () => {
      assert.equal(matchesTenantAndBranch({ tenant_id: TENANT, branch_id: BRANCH }, BRANCH, TENANT), true);
      assert.equal(matchesTenantAndBranch({ tenant_id: '', branch_id: BRANCH }, BRANCH, TENANT), false);
      assert.equal(matchesTenantAndBranch({ tenant_id: null, branch_id: BRANCH }, BRANCH, TENANT), false);
      assert.equal(matchesTenantAndBranch({ tenant_id: 'other_clinic', branch_id: BRANCH }, BRANCH, TENANT), false);
      assert.equal(matchesTenantAndBranch({ tenant_id: TENANT, branch_id: 'north' }, BRANCH, TENANT), false);
      assert.equal(matchesTenantAndBranch({ tenant_id: TENANT, branch_id: BRANCH }, BRANCH, ''), false);
      assert.equal(matchesTenantAndBranch({ tenant_id: TENANT, branch_id: BRANCH }, '', TENANT), false);

      const mixedPayments: Payment[] = [
        { id: 'p1', tenant_id: TENANT, branch_id: BRANCH, amount: 1_000_000, payment_date: REF_TODAY, status: 'completed' } as Payment,
        { id: 'p2', tenant_id: 'other_clinic', branch_id: BRANCH, amount: 9_000_000, payment_date: REF_TODAY, status: 'completed' } as Payment,
        { id: 'p3', tenant_id: TENANT, branch_id: 'north', amount: 8_000_000, payment_date: REF_TODAY, status: 'completed' } as Payment,
        { id: 'p4', tenant_id: null, branch_id: BRANCH, amount: 7_000_000, payment_date: REF_TODAY, status: 'completed' } as Payment,
      ];
      const res = computeDashboardMetrics(makeBaseInput({ payments: mixedPayments }));
      assert.equal(res.revenue.todayCollected, 1_000_000);
    },
  },
  {
    name: 'P0-06: Percentages are NEVER clamped at 100%, and chair capacity refuses silent 30m default when unconfigured',
    fn: () => {
      const units = [{ id: 'u1', name: 'Unit 1', status: 'active' as const, room: '1' }];
      const staff = [{ id: 'd1', first_name: 'Dr', last_name: 'A', role: 'dentist', active: true } as Staff];

      // Missing default_appointment_duration -> capacity MUST be null
      const noDurationSettings: ClinicSetting[] = [
        { id: 's1', key: 'clinic_morning_hours', value: '09:00-13:00' } as ClinicSetting,
      ];
      const capMissing = computeRealChairCapacity({
        units,
        staff,
        clinicSettings: noDurationSettings,
        activeTodaySlots: 5,
        referenceDateIso: REF_TODAY,
      });
      assert.equal(capMissing.slotDurationMinutes, null);
      assert.equal(capMissing.dailyChairCapacity, null);
      assert.equal(capMissing.chairUtilizationPct, null);

      // Configured 60m duration on 4h shift = capacity 4; 6 appointments = 150% (UNCLAMPED!)
      const fullSettings: ClinicSetting[] = [
        { id: 's1', key: 'clinic_morning_hours', value: '09:00-13:00' } as ClinicSetting,
        { id: 's2', key: 'default_appointment_duration', value: '60' } as ClinicSetting,
        { id: 's3', key: 'daily_revenue_target', value: '1000000' } as ClinicSetting,
        { id: 's4', key: 'monthly_revenue_target', value: '2000000' } as ClinicSetting,
      ];
      const overbookedAppts: Appointment[] = Array.from({ length: 6 }, (_, i) => ({
        id: `a_${i}`,
        tenant_id: TENANT,
        branch_id: BRANCH,
        appointment_date: REF_TODAY,
        appointment_time: '10:00',
        duration_min: 60,
        status: 'confirmed',
      })) as Appointment[];

      const res = computeDashboardMetrics(
        makeBaseInput({
          units,
          staff,
          clinicSettings: fullSettings,
          appointments: overbookedAppts,
          treatments: [
            {
              id: 't1',
              tenant_id: TENANT,
              branch_id: BRANCH,
              status: 'completed',
              total_cost: 2_000_000,
              discount: 0,
              performed_at: '2025-06-15T09:00:00Z',
            } as Treatment,
          ],
          payments: [
            {
              id: 'p1',
              tenant_id: TENANT,
              branch_id: BRANCH,
              amount: 3_000_000,
              payment_date: REF_TODAY,
              status: 'completed',
            } as Payment,
          ],
        })
      );
      assert.equal(res.capacity.dailyChairCapacity, 4);
      assert.equal(res.capacity.chairUtilizationPct, 150);
      assert.equal(res.pcRatioPct, 150);
      assert.equal(res.revenue.dailyGoalProgressPct, 300);
      assert.equal(res.revenue.monthlyGoalProgressPct, 150);
    },
  },
  {
    name: 'P0-07: Server RPC summary drives authoritative metrics when tenant/branch match, and is rejected fail-closed on scope mismatch',
    fn: () => {
      const rpcSummary: DashboardServerSummary = {
        tenant_id: TENANT,
        branch_id: BRANCH,
        today_iso: REF_TODAY,
        month_start: '2025-05-22',
        month_end: '2025-06-21',
        currency_unit: 'IRR_TOMAN',
        today_collected: 12_500_000,
        month_collected: 185_000_000,
        month_refunded: 2_000_000,
        month_extra_income: 5_000_000,
        month_total_cash_expense: 40_000_000,
        month_operating_expense: 35_000_000,
        month_treatment_production: 210_000_000,
        month_planned_production: 45_000_000,
        month_direct_costs: 65_000_000,
        unverified_completion_date_count: 2,
        completed_treatments_count: 610,
        planned_treatments_count: 42,
        active_treatments_count: 70,
        today_appointments_count: 18,
        confirmed_appointments_count: 15,
        active_today_slots: 16,
        pending_lab_count: 9,
        active_implant_count: 14,
        low_stock_count: 3,
        pending_reminders_count: 7,
        collection_checks_pending_amount: 30_000_000,
        guarantee_checks_pending_amount: 90_000_000,
        overdue_checks_count: 1,
        overdue_guarantee_checks_count: 0,
        overdue_installments_count: 2,
        overdue_safteh_count: 0,
        treatment_receivables: 25_000_000,
        standalone_installment_receivables: 5_000_000,
        standalone_collection_checks_amount: 10_000_000,
        total_receivables: 40_000_000,
        month_cash_flow: 150_000_000,
        month_net_profit: 115_000_000,
      };

      assert.equal(isValidDashboardServerSummary(rpcSummary, TENANT, BRANCH), true);
      assert.equal(isValidDashboardServerSummary(rpcSummary, TENANT, 'north'), false);

      const matched = computeDashboardMetrics(
        makeBaseInput({ financialDataComplete: false, serverSummary: rpcSummary })
      );
      assert.equal(matched.dataSourceMode, 'server_rpc');
      assert.equal(matched.financialDataComplete, true);
      assert.equal(matched.revenue.monthCollected, 185_000_000);
      assert.equal(matched.revenue.monthNetProfit, 115_000_000);
      assert.equal(matched.unverifiedCompletionDateCount, 2);

      const mismatched = computeDashboardMetrics(
        makeBaseInput({
          branchId: 'north',
          financialDataComplete: false,
          serverSummary: rpcSummary,
        })
      );
      assert.equal(mismatched.dataSourceMode, 'client_paginated');
      assert.equal(mismatched.financialDataComplete, false);
      assert.equal(mismatched.revenue.monthCollected, null);
    },
  },
  {
    name: 'P0-08: Data minimization (no phone PII on Dashboard patients) + partial/locked_offline/migration_required status handling',
    fn: () => {
      assert.equal(
        DASHBOARD_SELECTS.patients.split(',').includes('phone'),
        false,
        'Dashboard patients projection must NOT include phone PII'
      );

      assert.equal(isSchemaMigrationRequiredError({ code: '42703' }), true);
      assert.equal(
        reconcileServerRows({ serverRows: [{ id: '1' }], error: null, isOffline: false, truncated: true }).status,
        'partial'
      );
      assert.equal(
        reconcileServerRows({ serverRows: null, error: { code: '42501' }, isOffline: false }).status,
        'unauthorized'
      );
      assert.equal(
        shouldAcceptTableResponse({
          requestSeq: 2,
          currentSeq: 3,
          requestScopeKey: 'a',
          activeScopeKey: 'a',
          aborted: false,
          mounted: true,
        }),
        false
      );

      const partialAgg = evaluateDashboardSourceStatuses(
        makeAllReadyStatuses({ payments: 'partial' }),
        { isStale: false, isLoading: false, errorMessage: null }
      );
      assert.equal(partialAgg.overall, 'partial');
      assert.equal(partialAgg.financialDataComplete, false);
      assert.deepEqual(partialAgg.truncatedSources, ['payments']);

      const lockedAgg = evaluateDashboardSourceStatuses(
        makeAllReadyStatuses({ patients: 'locked_offline', payments: 'locked_offline' }),
        { isStale: true, isLoading: false, errorMessage: null }
      );
      assert.equal(lockedAgg.overall, 'locked_offline');
      assert.equal(lockedAgg.financialDataComplete, false);
      assert.deepEqual(lockedAgg.lockedOfflineTables, ['patients', 'payments']);
    },
  },
  {
    name: 'P0-09: Real WebCrypto AES-GCM 256-bit non-extractable Vault encryption enforces AAD binding, tampering rejection, TTL expiry, and key wipe lock',
    fn: async () => {
      clearAllSessionVaultKeys();
      const scopeA = { tenantId: TENANT, branchId: 'main', userId: 'usr_manager_1' };
      const scopeB = { tenantId: TENANT, branchId: 'north', userId: 'usr_manager_1' };
      const payload = [{ id: 'pt-1', first_name: 'سارا', phone: '09120001122' }];

      assert.equal(getVaultMirrorKey('patients', scopeA), `${TENANT}::main::usr_manager_1::patients`);
      assert.equal(getVaultMirrorKey('patients', { tenantId: '', branchId: 'main', userId: 'u1' }), null);
      assert.equal(generateRandomHex(8).length, 16);

      const blob = await encryptVaultPayload(payload, scopeA, 'patients', 60_000);
      assert.ok(blob, 'encryptVaultPayload must return AES-GCM blob');
      assert.equal(blob.version, VAULT_CRYPTO_VERSION);
      assert.equal(blob.alg, 'AES-GCM');

      // 1. Valid decrypt with exact scope + table succeeds
      const decOk = await decryptVaultPayload<typeof payload>(blob, scopeA, 'patients');
      assert.deepEqual(decOk, payload);

      // 2. Swapping table name fails AAD verification
      const decWrongTable = await decryptVaultPayload(blob, scopeA, 'payments');
      assert.equal(decWrongTable, null);

      // 3. Swapping branch fails key + AAD verification
      const decWrongBranch = await decryptVaultPayload(blob, scopeB, 'patients');
      assert.equal(decWrongBranch, null);

      // 4. Bit-flipping ciphertext fails GCM authentication tag
      const tampered = {
        ...blob,
        cipherBase64:
          (blob.cipherBase64[0] === 'A' ? 'B' : 'A') + blob.cipherBase64.slice(1),
      };
      const decTampered = await decryptVaultPayload(tampered, scopeA, 'patients');
      assert.equal(decTampered, null);

      // 5. Expired TTL fails closed
      const expired = { ...blob, expiresAt: new Date(Date.now() - 5000).toISOString() };
      const decExpired = await decryptVaultPayload(expired, scopeA, 'patients');
      assert.equal(decExpired, null);

      // 6. After clearAllSessionVaultKeys() (reload / signout), volatile key is gone -> decrypt returns null (locked)
      clearAllSessionVaultKeys();
      const decAfterWipe = await decryptVaultPayload(blob, scopeA, 'patients');
      assert.equal(decAfterWipe, null);
    },
  },
  {
    name: 'P1-01: Access control, hash URL routing, integer money conversion, and QBank pixel-true SVG path invariants',
    fn: () => {
      assert.equal(toBaseIntMoney(123456.7), 123457);
      assert.equal(toBaseIntMoney(Number.NaN), 0);

      assert.equal(
        resolveEffectiveRole({
          serverVerifiedRole: 'secretary',
          localRole: 'manager',
          sessionStatus: 'authenticated',
        }),
        'secretary'
      );
      assert.equal(canAccessRoute('assistant', 'finance'), false);
      assert.equal(canAccessRoute('assistant', 'reports'), false);
      assert.equal(canPerformAction('secretary', 'edit_saved_prices'), false);
      assert.equal(canPerformAction('secretary', 'manage_staff_shares'), false);
      assert.equal(canAccessRoute('manager', 'finance'), true);

      const url = buildRouteHashUrl('finance', { subTab: 'checks', recordId: 'chk-99' });
      const parsed = parseRouteFromUrl(url);
      assert.ok(parsed);
      assert.equal(parsed.route, 'finance');
      assert.equal(parsed.params.subTab, 'checks');
      assert.equal(parsed.params.recordId, 'chk-99');

      const pathNarrow = buildQBankNotchPath(160, 96);
      const pathWide = buildQBankNotchPath(340, 108);
      assert.ok(pathNarrow.startsWith('M ') && pathNarrow.endsWith('Z') && !pathNarrow.includes('NaN'));
      assert.ok(pathWide.startsWith('M ') && pathWide.endsWith('Z') && !pathWide.includes('NaN'));
    },
  },
];

export async function runAllV4ProductionTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, passed: true });
    } catch (err: unknown) {
      results.push({
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.stack || err.message : String(err),
      });
    }
  }
  return results;
}
