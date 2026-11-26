# ADR-006: Atomic Double-Entry Journal, Charge Allocations & Exact Integer Toman Precision

- **Status**: Accepted (V16)
- **Context**: Prior client code scattered unlinked inserts across `payments`, `finance_transactions`, and `treatments.paid_amount`, relied on `Math.max(directPaid, paymentsTotal)`, summed `planned` treatments into receivables, treated guarantee checks as collectible, allowed in-place editing/deletion of posted treasury entries, and parsed HTML `type="number"` inputs inconsistently for Persian digits.
- **Decision**:
  1. Adopt **IRR_TOMAN** as the canonical integer monetary contract (`bigint` in PostgreSQL, safe integers in TypeScript via `parseExactTomanAmount`).
  2. Separate `service_charges` (`estimate | draft | posted | reversed`) from `payment_allocations` and balanced `journal_entries`/`journal_lines`, orchestrated atomically by `post_patient_payment_v16`, `reverse_or_refund_payment_v16`, and `reconcile_day_close_v16`.
  3. Enforce posted-record immutability in PostgreSQL triggers and RBAC separation (`manager | secretary` for collection/day-close; `manager` only for refunds, reversals, and period reopening).
  4. Share one canonical read-model (`financialLedgerEngine.ts`) across Dashboard KPIs, Finance Hub, and `PatientDetailHub`.
- **Consequences**:
  - Offline financial drafts are strictly queued outside confirmed clinic cash totals and require membership re-verification before replay.
  - Live Supabase deployment on `npzcweiphmyhtzxxnlov` requires forward application of `20261129000000`, `20261130000000`, and `20261201000000` (without replaying V12).
