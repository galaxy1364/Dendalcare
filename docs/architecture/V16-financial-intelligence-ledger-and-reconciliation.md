# MinaDental V16 — Financial Intelligence, Atomic Double-Entry Ledger & Reconciliation

- **Trace ID**: `TRC-MINA-V16-FINANCE-9018-Q`
- **Target Supabase Project**: `npzcweiphmyhtzxxnlov`
- **Incremental Migration**: `supabase/migrations/20261201000000_v16_financial_intelligence_ledger_and_reconciliation.sql`
- **Currency Contract**: `IRR_TOMAN` (integer Toman only; zero floating-point drift; explicit `BigInt` × 10 conversion to Rial when explicitly requested)
- **Timezone Contract**: `Asia/Tehran` for business date boundaries and Solar (Jalali) monthly periods

## 1. Release Holds Closed
- **V14 Idempotency Hardening**: `appointment_command_idempotency` has no client `INSERT` policy; entries are written solely by `private.record_appointment_idempotency_v14`.
- **V15 Durable Clinical Record**: Allergy verification reviews, versioned consents, clinical notes, and ISO 3950 odontogram observations hydrate from PostgreSQL and persist via project-namespaced storage + server RPC/upsert checks (`persisted_server | queued_offline_draft | rejected | unknown`).

## 2. Core Financial Invariants
1. **Atomic Posting (`post_patient_payment_v16`)**:
   - Single PostgreSQL transaction inserts into `payments`, writes `payment_allocations` against `service_charges`, creates a balanced `journal_entries` + `journal_lines` set (`SUM(debit) == SUM(credit)` verified by deferred constraint trigger `verify_journal_entry_balanced`), links a `finance_transactions` row (`payment_id` + `PAY:<id>`), and records `financial_audit_events`.
   - Eliminates `Math.max(totalDirectPaid, totalPaymentsTable)` and unlinked client multi-table inserts.
2. **Estimates vs. Posted Obligations & Installments**:
   - `planned` treatments remain non-binding estimates excluded from confirmed receivables (`totalRemainingDebt`).
   - Installment plans schedule payment of posted/accepted obligations without double-counting principal on top of underlying treatment charges.
3. **Guarantee Collateral Separation**:
   - `checks` with `is_guarantee = true` / `type = 'guarantee'` / `instrument_purpose = 'guarantee'` and `safteh` promissory notes are held in collateral custody (`totalGuaranteeChecksHeld`) and never counted as collectible cash or settled debt.
4. **Posted-Record Immutability & Period Reversals**:
   - Trigger `prevent_posted_finance_tx_mutation` blocks silent `UPDATE` or `DELETE` of posted `finance_transactions`.
   - Manager-only `reverse_or_refund_payment_v16` posts compensating refund/reversal records in the refund business period without mutating historical month gross receipts.
5. **Localized Precision (`monetaryPrecision.ts`)**:
   - Accepts Persian (`۰-۹`) and Arabic (`٠-٩`) numerals plus thousand separators while rejecting decimals/fractions, negatives, zero (where disallowed), scientific notation, and overflow.
6. **Daily Close Reconciliation (`reconcile_day_close_v16`)**:
   - Tracks opening drawer balance, expected cash/card/transfer/refunds, counted cash, and cash variance without silent auto-balancing. Closed business dates reject new postings unless explicitly reopened by a `manager` with a mandatory audit reason.
7. **Privacy-Safe Financial Reminders**:
   - Deterministic `sourceKey` deduplicates check, installment, and AR reminders while omitting clinical diagnoses and sensitive amounts from lock-screen preview titles.
8. **Modular Architecture**:
   - `Finance.tsx` refactored under 200 lines; feature modules (`monetaryPrecision.ts`, `financialLedgerEngine.ts`, `financialCommandService.ts`, `FinanceDebtorsTab.tsx`, `FinanceDoctorShareTab.tsx`, `FinanceInstrumentsTabs.tsx`, `FinanceTransactionsAndCloseTab.tsx`) all kept `<= 500` lines.
