---
name: l2-upgrade-state-invariant-guardrail
description: Guard state transition and snapshot invariants in TokamakL2JS. Use when changing `TokamakL2StateManager`, snapshot loading/capture logic, Merkle tree reconstruction, storage key registration/permutation, or RPC/snapshot initialization paths.
---

# State Invariant Guardrail

Use this workflow to prevent state-root drift and snapshot corruption after upgrades.

## 1. Identify invariant-sensitive changes

1. Inspect diffs under `src/stateManager/` and `src/interface/stateSnapshot/`.
2. Mark changes touching:
`initTokamakExtendsFromSnapshot`, `fetchStorageFromSnapshot`, `captureStateSnapshot`,
`convertLeavesIntoMerkleTreeLeavesForAddress`, `getUpdatedMerkleTreeRoots`.

## 2. Check structural invariants

1. Keep per-address array lengths aligned:
`storageAddresses`, `registeredKeys`, `storageEntries`, `preAllocatedLeaves`, `stateRoots`.
2. Keep key membership consistent:
registered keys must equal the union of pre-allocated keys and storage-entry keys.
3. Preserve address-index ordering across root reconstruction and snapshot capture.

## 3. Check Merkle and lookup invariants

1. Ensure reconstructed roots match provided snapshot roots for every address.
2. Ensure unknown address/key lookup behavior stays explicit and deterministic.
3. Ensure key permutation logic preserves key multiset and address binding.

## 4. Verify failure paths

1. Invalid snapshot shape must fail fast with clear errors.
2. Root mismatch must fail initialization.
3. Duplicate key material must be rejected.

## 5. Validate and report

1. Run `npm run build`.
2. Provide invariant report:
- validated invariants
- new/changed failure modes
- pass/fail gate decision
