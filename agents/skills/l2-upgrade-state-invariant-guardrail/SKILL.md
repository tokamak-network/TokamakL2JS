---
name: l2-upgrade-state-invariant-guardrail
description: Guard state transition and snapshot invariants in TokamakL2JS. Use when changing `TokamakL2StateManager`, snapshot loading/capture logic, Merkle tree reconstruction, storage key registration/permutation, or RPC/snapshot initialization paths.
---

# State Invariant Guardrail

Use this skill to prevent state-root drift and snapshot corruption.

## Quick Start

```bash
bash agents/skills/l2-upgrade-state-invariant-guardrail/scripts/check-state-manager-guards.sh
node agents/skills/l2-upgrade-state-invariant-guardrail/scripts/validate-state-snapshot.mjs <snapshot.json>
npm run build
```

## Workflow

1. Run `check-state-manager-guards.sh` to verify critical guard clauses still exist in `TokamakL2StateManager`.
2. Run `validate-state-snapshot.mjs` against any updated snapshot fixture or captured snapshot artifact.
3. Ensure these invariant classes hold:
- shape invariants: aligned per-address arrays
- membership invariants: registered keys == union of pre-allocated and storage entry keys
- address uniqueness and key uniqueness constraints
4. Run `npm run build` after invariant checks.

## Snapshot Validator Contract

`validate-state-snapshot.mjs` fails on:
- malformed or missing required fields
- length mismatch among `storageAddresses`, `registeredKeys`, `storageEntries`, `preAllocatedLeaves`, `stateRoots`
- duplicate addresses
- key set mismatch per address

## Guard Script Contract

`check-state-manager-guards.sh` fails when key guard patterns disappear from `src/stateManager/TokamakL2StateManager.ts`.

## Reporting

Report:
- files changed under `src/stateManager/` and `src/interface/stateSnapshot/`
- snapshot validator result
- source guard result
- build result and final pass/fail decision

Use invariant intent notes in `references/invariants.md`.
