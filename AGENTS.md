# Dendalcare — mandatory development coordination

Owner directive: ChatGPT and Google AI Studio/Gemini must work on one shared project, never independently overwrite each other's changes.

Canonical coordination record: https://github.com/galaxy1364/Dendalcare/issues/4
Canonical source: GitHub galaxy1364/Dendalcare.
Database: Supabase project npzcweiphmyhtzxxnlov (development).

## Required workflow (all agents)
1. Before editing, read this file, GEMINI.md, docs/architecture/V12-development-coordination.md and the latest coordination record; inspect current main HEAD, active branch/PR, pending AI Studio changes, and actual migration history. If a source is inaccessible, report it; never guess.
2. One writer at a time. Declare owner, scope, branch and base commit in the coordination record before editing. Other agents review only until an explicit handoff. Work on the designated branch; never silently switch to main, overwrite unsynced AI Studio files, or force push.
3. Before touching shared database or deployments, confirm target project and pending migrations. Never replay already applied SQL, fabricate data, or expose credentials. Treat Git migration files and the live migration ledger as separate evidence to reconcile.
4. For each change, record files, rationale, commit SHA, migration IDs, live actions, test evidence, known issues, and next owner. Give the other agent a handoff with links and exact instructions. If direct delivery is unavailable, provide the handoff to the user for pasting into AI Studio; do not claim it was delivered.
5. Before merge, reconcile overlapping PRs and verify typecheck, build, unit tests, real browser tests, authorization and database checks as relevant. Require review and passing checks. Do not bypass checks or claim zero errors.
6. Do not change main or deploy unless scope and checks justify it. If AI Studio cannot select the branch or has uncommitted edits, stop and export/preserve them before syncing. Never resolve all conflicts blindly.
7. After handoff, release the writer role in the coordination record. This is a human/agent protocol, not a server-enforced lock. GitHub branch protection should enforce merge gates where supported.

Project scope: preserve working Persian RTL mobile QBank layout, dynamic Aurora, clinical and financial truth, security, recovery and platform capabilities. No real patient data in development. Keep future schema changes versioned and reversible where possible.

## Protected engineering baseline
Read [docs/engineering/MASTER_PROTOCOL.md](docs/engineering/MASTER_PROTOCOL.md) before any task. Its release, clinical safety, RTL and regression requirements are mandatory. CI evidence and the latest coordination record override historical snapshots. Never claim a document enforces repository permissions.
