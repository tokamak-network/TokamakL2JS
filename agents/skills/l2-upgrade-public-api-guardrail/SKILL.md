---
name: l2-upgrade-public-api-guardrail
description: Guard public API compatibility for TokamakL2JS upgrades. Use when changing exported functions/classes/types, `src/index.ts` export surface, `src/interface/configuration/types.ts`, transaction/state manager public methods, or preparing an npm version bump/release.
---

# Public API Guardrail

Use this workflow to prevent accidental breaking changes in the published package.

## 1. Scope the API impact

1. List changed files with `git diff --name-only`.
2. Mark any change in:
`src/index.ts`, `src/tx/`, `src/stateManager/`, `src/crypto/`, `src/interface/`, `package.json`.
3. Treat marked files as public-impact candidates unless proven internal-only.

## 2. Build an API delta table

1. Compare old vs new exported identifiers from `src/index.ts`.
2. Compare old vs new signatures for:
`TokamakL2Tx`, `TokamakL2StateManager`, constructor helpers, config/snapshot types.
3. Classify each delta:
`breaking`, `additive`, or `internal`.

Use `breaking` for:
- removed/renamed export
- required field addition in exported types
- narrowed union/literal types
- changed argument order/meaning

## 3. Enforce compatibility actions

1. If any `breaking` delta exists, require one:
- compatibility wrapper/alias, or
- explicit major-version decision
2. If semver level does not match delta severity, block release.

## 4. Verify package surface

1. Run `npm run build`.
2. Run `npm pack --dry-run`.
3. Confirm `package.json` `exports`, `main`, `types`, and `files` still align with generated `dist`.

## 5. Report gate result

Publish a compact report with:
- changed public symbols
- severity per symbol (`breaking`/`additive`/`internal`)
- required release version impact
- pass/fail decision with blockers
