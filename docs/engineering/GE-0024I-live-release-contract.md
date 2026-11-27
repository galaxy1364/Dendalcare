# GE-0024I — Live release contract, 2026-11-27

Status: BLOCKED, not published. Owner explicitly authorizes publication; visual architecture sign-off is separate.

- Configured target: npzcweiphmyhtzxxnlov. Live migration ledger verified read-only: 20261125213357 v12_empty_clinic_foundation, 20261125213523 v12_advisor_hardening, 20261125213554 v12_rpc_grants.
- Current live counts (aggregate only): 0 patients, 0 payments, 0 finance transactions, 0 auth users, 0 memberships. The project is not a validated operational clinic environment. No data changes performed.
- Exact three client RPCs are absent: post_patient_payment_v16, reverse_or_refund_payment_v16, reconcile_day_close_v16. Instrument clearing is a composed client operation, not a fourth installed RPC. Read-only preflight: supabase/scripts/verify_v16_release_contract.sql. All three returned installed=false.
- Live payments and finance_transactions lack created_by; staged V16 migration adds nullable UUID columns (no historical attribution invented). On rechecking the actual SQL declaration, the payment RPC GRANT/REVOKE signature already matches; no change needed.
- V16 staged migration is NOT applied. Its stated V14/V15 prerequisites are not present in the live migration ledger. Do not replay old migrations indiscriminately.
- Additional source review blockers: refund command does not record/replay an idempotency receipt or reconcile allocations/treasury; day-close subtracts all refunds from cash regardless of payment method and does not validate action server-side; instrument status changes precede confirmed payment. These need explicit transactional design and authorization tests, not just catalog presence.
- Required next gate: reviewed forward compatibility plan, isolated synthetic fixtures and actual manager/secretary/unauthorized positive and negative RPC tests, cross-branch isolation, retries, accounting reconciliation, independent review, then verified signed release.
- Previous CI 46071186484 green at 70514900798c791e95c109934fb5330bfb22d53b. Official Build 308 unchanged. No main/production/DB/signing changes. Unsynced AI Studio not accessible.
