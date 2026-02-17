# Task Log

## Task: Enforce version-upgrade commit naming rule for publish

### Plan
- [x] Update release gate semver checks to require `NPM version upgrade to <version>` commit subject when `package.json` version is bumped.
- [x] Update release skill docs/policy to describe the commit naming requirement.
- [x] Run representative gate validation and record outcomes.
- [x] Add review notes and outcomes.

### Review
- Added release-gate rule: when `package.json` version bump is detected (`major`/`minor`/`patch`), commit history in `baseRef..HEAD` must include exact subject:
`NPM version upgrade to <current version>`.
- Updated docs/policy to reflect the new publish blocker.
- Validation runs:
  - `bash agents/skills/upgrade-release-readiness-guardrail/scripts/release-readiness-gate.sh HEAD~1` -> fails as expected on unchanged version (`EXIT_CODE:5`).
  - Semver check path with bumped-version scenario (base `d1a4400`, synthetic report `breaking=0`) -> fails as expected when required commit subject is missing (`EXIT_CODE:5`).

## Task: Enforce version bump in release-readiness gate

### Plan
- [x] Update release gate semver rule to fail when `package.json` version is unchanged vs base ref.
- [x] Update release skill documentation/policy to reflect strict version bump requirement for publish.
- [x] Run release gate once to verify unchanged-version path fails as expected.
- [x] Add review notes and outcomes.

### Review
- Added explicit `bump === 'same'` failure in `upgrade-release-readiness-guardrail` semver checks.
- Updated release skill docs/policy to require version bump for publish attempts.
- Fixed exit-code capture bug in release gate (`if ! cmd; then code=$?`) that could mask command failures; switched to `cmd || code=$?` for all gate steps.
- Validation run:
  - `bash agents/skills/upgrade-release-readiness-guardrail/scripts/release-readiness-gate.sh HEAD~1`
  - result: failed as expected with `Version must be bumped for publish (same version as base ref).`
  - exit code: `5`.

## Task: Reorganize guardrail skills into six-skill upgrade suite

### Plan
- [x] Rename existing `l2-upgrade-*` skills into requested `upgrade-*` naming and role mapping.
- [x] Strengthen `upgrade-public-api-guardrail` to include class constructors/member method compatibility checks for all APIs exported via `src/index.ts`.
- [x] Keep `upgrade-release-readiness-guardrail` behavior while updating it to the renamed skill paths.
- [x] Create `upgrade-crypto-guardrail` for `src/crypto/` upgrades with executable checks.
- [x] Create `upgrade-state-manager-guardrail` from the current state-invariant guardrail with updated scope/name.
- [x] Create `upgrade-tx-guardrail` from tx/crypto guardrail by removing crypto-focused content.
- [x] Create `upgrade-block-guardrail` for `src/block/` upgrades with executable checks.
- [x] Run representative verification commands and record results.
- [x] Add review notes and outcomes.

### Review
- Reorganized `agents/skills/` into six skills:
  - `upgrade-public-api-guardrail`
  - `upgrade-release-readiness-guardrail`
  - `upgrade-crypto-guardrail`
  - `upgrade-state-manager-guardrail`
  - `upgrade-tx-guardrail`
  - `upgrade-block-guardrail`
- Removed old `l2-upgrade-*` naming by moving folders and updating all internal script references.
- Upgraded public API guardrail implementation (`scripts/check-public-api.mjs`) to track symbol-level API from `src/index.ts` re-export graph, including:
  - exported function signature changes
  - exported class constructor changes
  - exported class public method/accessor changes
  - existing config-type breaking checks (`src/interface/configuration/types.ts`)
- Kept release readiness guardrail purpose while updating path wiring and splitting tx/crypto checks into:
  - `upgrade-tx-guardrail/scripts/tx-smoke.mjs`
  - `upgrade-crypto-guardrail/scripts/crypto-smoke.mjs`
- Added two new practical skills with executable smoke checks:
  - crypto guardrail with fixed vectors (`upgrade-crypto-guardrail`)
  - block guardrail with block assembly vector checks (`upgrade-block-guardrail`)
- Validation runs:
  - `npm run build` passed.
  - `node agents/skills/upgrade-public-api-guardrail/scripts/check-public-api.mjs --base HEAD~1` passed.
  - `bash agents/skills/upgrade-state-manager-guardrail/scripts/check-state-manager-guards.sh` passed.
  - `node agents/skills/upgrade-state-manager-guardrail/scripts/validate-state-snapshot.mjs /tmp/tokamak-snapshot-valid.json` passed.
  - `node agents/skills/upgrade-tx-guardrail/scripts/tx-smoke.mjs` passed.
  - `node agents/skills/upgrade-crypto-guardrail/scripts/crypto-smoke.mjs` passed.
  - `node agents/skills/upgrade-block-guardrail/scripts/block-smoke.mjs` passed.
  - `bash agents/skills/upgrade-release-readiness-guardrail/scripts/release-readiness-gate.sh HEAD~1` passed.

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
