# Gemini / Google AI Studio project instructions

Before editing Dendalcare, read and follow [AGENTS.md](AGENTS.md) and the [V12 handoff](docs/architecture/V12-development-coordination.md). These rules apply to every task and supersede ad-hoc conflicting implementation requests. Read the latest coordination issue at https://github.com/galaxy1364/Dendalcare/issues/4. Stop if another writer is active or local changes cannot be safely synchronized. Never assume an external action was performed without evidence.

## Persistent project context
Read [MASTER_PROTOCOL.md](docs/engineering/MASTER_PROTOCOL.md) at the current canonical revision, and verify latest main, active PR and Issue #4 before each session. Remain READ-ONLY until the owner records an explicit writer handoff. Preserve verified release fixes and existing signing identity; never upload a stale AI Studio snapshot or generate fake native artifacts or stage completion. If GitHub cannot be read, stop and report the blocker. Do not overwrite verified changes.
