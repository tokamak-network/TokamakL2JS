# Task Log

## Task: Evolve all four upgrade guardrail skills into practical workflows

### Plan
- [x] Upgrade `l2-upgrade-public-api-guardrail` with executable API diff tooling and machine-readable reports.
- [x] Upgrade `l2-upgrade-state-invariant-guardrail` with executable snapshot/invariant validation tooling.
- [x] Upgrade `l2-upgrade-tx-crypto-guardrail` with deterministic tx/crypto smoke checks runnable in CI/local.
- [x] Upgrade `l2-upgrade-release-readiness-guardrail` with an end-to-end release gate script.
- [x] Update SKILL docs to reference concrete scripts, outputs, and pass/fail criteria.
- [x] Run representative verification commands for all new scripts and record outcomes.
- [x] Add review notes and outcomes.

### Review
- Upgraded all four skills from checklist text to executable workflows with concrete scripts and references.
- Added executable resources:
  - Public API: `scripts/check-public-api.mjs`, `references/severity-rules.md`
  - State invariants: `scripts/check-state-manager-guards.sh`, `scripts/validate-state-snapshot.mjs`, `references/invariants.md`
  - Tx/Crypto: `scripts/tx-crypto-smoke.mjs`, `references/acceptance-checks.md`
  - Release readiness: `scripts/release-readiness-gate.sh`, `references/release-policy.md`
- Updated each `SKILL.md` with quick-start commands, output artifacts, and explicit fail conditions.
- Added `agents/skills/.gitignore` to ignore generated `out/` artifacts from guardrail runs.
- Release gate robustness fix: switched `npm pack --dry-run` to use local cache under skill `out/.npm-cache` to avoid environment-specific `~/.npm` permission issues.
- Validation runs:
  - `node agents/skills/l2-upgrade-public-api-guardrail/scripts/check-public-api.mjs --base HEAD~1` passed.
  - `bash agents/skills/l2-upgrade-state-invariant-guardrail/scripts/check-state-manager-guards.sh` passed.
  - `node agents/skills/l2-upgrade-state-invariant-guardrail/scripts/validate-state-snapshot.mjs /tmp/tokamak-snapshot-valid.json` passed.
  - `npm run build` passed.
  - `node agents/skills/l2-upgrade-tx-crypto-guardrail/scripts/tx-crypto-smoke.mjs` passed.
  - `bash agents/skills/l2-upgrade-release-readiness-guardrail/scripts/release-readiness-gate.sh HEAD~1` passed after cache-path fix.

## Task: Draft upgrade guardrail skills for TokamakL2JS

### Plan
- [x] Define guardrail scope based on current public surface (`crypto`, `stateManager`, `tx`, config types, package exports).
- [x] Create multiple draft skills under `agents/skills/` with strong trigger descriptions and upgrade-safe workflows.
- [x] Ensure each draft skill includes concrete verification gates (API compatibility, state invariants, tx behavior, release checks).
- [x] Review draft quality for clarity and minimal overlap.
- [x] Add review notes and outcomes.

### Review
- Added four draft guardrail skills under `agents/skills/`:
`l2-upgrade-public-api-guardrail`, `l2-upgrade-state-invariant-guardrail`,
`l2-upgrade-tx-crypto-guardrail`, `l2-upgrade-release-readiness-guardrail`.
- Each skill includes explicit trigger contexts in YAML `description` and a procedural gate workflow in the body.
- Verification gates are embedded in the drafts (`npm run build`, `npm pack --dry-run`, invariant and compatibility reporting requirements).
- Validation run: `npm run build` passed (`build:esm` + `build:cjs`).
- `skill-creator` validator scripts could not run in this environment due missing dependency (`ModuleNotFoundError: No module named 'yaml'`).

## Task: Finish multi-tree support in captureStateSnapshot

### Plan
- [x] Rewrite `captureStateSnapshot` in `src/stateManager/TokamakL2StateManager.ts` to emit multi-tree `StateSnapshot` shape.
- [x] Ensure per-address mapping for `registeredKeys`, `storageEntries`, and `preAllocatedLeaves`.
- [x] Build `stateRoots` consistently with `storageAddresses` ordering.
- [x] Run TypeScript build to verify compilation.
- [x] Add review notes and outcomes.

### Review
- Updated `captureStateSnapshot` for multi-address snapshot output (`stateRoots`, `storageAddresses`, nested arrays).
- Added per-address re-fetch for `storageEntries` and `preAllocatedLeaves` using each storage address from the previous snapshot.
- Added consistency checks for snapshot array lengths and uninitialized registered keys.
- Validation run: `npm run build` failed due to pre-existing unrelated errors:
  - `src/interface/configuration/utils.ts`: `contractAddress` should be `entryContractAddress`.
  - `src/stateManager/constructors.ts`: imports `StateSnapshot` from `./types.js`, but it is exported from `src/interface/stateSnapshot/types.ts`.

## Task: Deduplicate `safeConversion` into shared utility

### Plan
- [x] Add `treeNodeToBigint` utility in `src/stateManager/utils.ts`.
- [x] Replace duplicated local `safeConversion` functions with `treeNodeToBigint` in `src/stateManager/TokamakL2StateManager.ts`.
- [x] Run TypeScript build to verify no new errors from this refactor.
- [x] Add review notes and outcomes.

### Review
- Added `treeNodeToBigint` utility in `src/stateManager/utils.ts` to normalize IMT node -> `bigint` conversion.
- Replaced both local `safeConversion` blocks in `src/stateManager/TokamakL2StateManager.ts` with the shared utility.
- Removed now-unneeded imports (`bigIntToBytes`, `toBytes`) from `src/stateManager/TokamakL2StateManager.ts`.
- Validation run: `npm run build` still fails only on pre-existing unrelated errors:
  - `src/interface/configuration/utils.ts`: `contractAddress` should be `entryContractAddress`.
  - `src/stateManager/constructors.ts`: imports `StateSnapshot` from `./types.js`, but it is exported from `src/interface/stateSnapshot/types.ts`.

## Task: Align fromRPC example config with `ChannelStateConfig`

### Plan
- [x] Compare `examples/stateManager/fromRPC/config.json` against `src/interface/configuration/types.ts` (`ChannelStateConfig`).
- [x] Update config keys/shape to match `ChannelStateConfig` exactly.
- [x] Validate JSON syntax after edit.

### Review
- Replaced top-level `userStorageSlots` and `preAllocatedKeys` with `storageConfigs` array.
- Renamed `contractAddress` to `entryContractAddress`.
- Preserved original address/key values by mapping them into `storageConfigs[0]`.
- Validation run: `node -e "JSON.parse(...)"` returned `ok`.

## Task: Return `[-1, -1]` when address is missing in `getMerkleTreeLeafIndex`

### Plan
- [x] Update `getMerkleTreeLeafIndex` in `src/stateManager/TokamakL2StateManager.ts` to early-return `[-1, -1]` when `addressIndex === -1`.
- [x] Run targeted verification to ensure no regressions from this change.
- [x] Add review notes and outcomes.

### Review
- Added early guard in `getMerkleTreeLeafIndex` to return `[-1, -1]` immediately if no matching address is found.
- Preserved existing behavior for valid address matches (`leafIndex` is still computed by key lookup).
- Validation run: `npm run build` passed (`build:esm` + `build:cjs`).

## Task: Fix Snapshot Init Merkle Root Reconstruction

### Plan
- [x] Fix leaf construction in `convertLeavesIntoMerkleTreeLeavesForAddress` to index registered keys correctly.
- [x] Correct snapshot root mismatch check in `initTokamakExtendsFromSnapshot` to fail when any root mismatches.
- [x] Run build verification and capture outcomes.
- [x] Add review notes and conclusions.

### Review
- Root cause identified: leaf reconstruction used `registeredKeysForAddress[index]` (object index access) instead of `registeredKeysForAddress.keys[index]`, causing keys to resolve as `undefined` and leaf hashing to collapse to zero-filled inputs.
- Fixed snapshot validation logic from `every(mismatch)` to `some(mismatch)`, so initialization fails when any reconstructed root diverges from snapshot roots.
- Validation run: `npm run build` passed (`build:esm` + `build:cjs`).
