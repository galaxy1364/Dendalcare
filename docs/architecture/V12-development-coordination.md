# V12 handoff — live database work already completed

Read the permanent coordination issue: https://github.com/galaxy1364/Dendalcare/issues/4

- Main last observed: e7b6b0ecc60796f687fc9d077d2343d786870ead.
- Active branch: upgrade/v12-clinical-foundation. ChatGPT database foundation work complete; next writer should be Gemini only after reading this branch and preserving any pending local edits.
- New Supabase development project: npzcweiphmyhtzxxnlov.
- Live migrations already applied: v12_empty_clinic_foundation (version 20261125213357), v12_advisor_hardening, v12_rpc_grants. Query the live migration ledger for latest versions. Source files are in supabase/baselines/. DO NOT rerun these blindly. No secrets.
- Verified after baseline: 23 public tables, 51 FKs, 83 policies, FORCE RLS on all 23, 0 patients and 0 auth users, 0 anonymous table grants. Anonymous dashboard RPC execution revoked and verified false. Security Advisor last showed INFO only; private audit table has no client policy by design. Unused index INFO expected on empty DB.
- Remaining blockers: no authorized test users or tenant/branch fixtures; clinical CRUD and negative cross-tenant/branch RLS tests not yet run; API/UI integration, full CI, actual old-to-new PWA upgrade not verified. Baseline is not a certification.
- PR #2 V10 remains open and needs review/reconciliation. PR #3 V11 already merged. V12 files are not on main yet. Never blindly merge parallel branches.
- Next: reconcile existing schema contract and generated types, provision authorized development fixtures through safe means, test actual CRUD and role separation, verify dashboard RPC and clinical workflows, run CI + Chromium/WebKit. No production deployment until verified.
- Handoff requirements for every subsequent task: base/head commit, owner, changed files, migration versions and whether applied, test outcomes, remaining blockers, next owner. Update coordination record before any ownership change.
