---
name: upgrade-state-manager-guardrail
description: Guard `src/stateManager/` upgrade safety in TokamakL2JS. Use when changing `TokamakL2StateManager`, state-manager constructors/types/utils, snapshot loading/capture logic, Merkle reconstruction, or storage key registration/permutation behavior.
---

# State Manager Guardrail

Use this skill to prevent state-root drift and snapshot corruption.

## Quick Start

```bash
bash agents/skills/upgrade-state-manager-guardrail/scripts/check-state-manager-guards.sh
node agents/skills/upgrade-state-manager-guardrail/scripts/validate-state-snapshot.mjs <snapshot.json>
npm run build
```

## Workflow

1. Run `check-state-manager-guards.sh` to verify critical guard clauses remain in `src/stateManager/TokamakL2StateManager.ts`.
2. Run `validate-state-snapshot.mjs` for updated or newly captured snapshots.
3. Confirm invariant classes:
- aligned per-address arrays (`storageAddresses`, `registeredKeys`, `storageEntries`, `preAllocatedLeaves`, `stateRoots`)
- registered key set equals snapshot key union
- deterministic unknown-address behavior
4. Run `npm run build` and block merge on failure.

## Reporting

Capture:
- changed files under `src/stateManager/` and `src/interface/stateSnapshot/`
- guard script result
- snapshot validator result
- build result and final gate decision

Use invariant notes in `references/invariants.md`.
