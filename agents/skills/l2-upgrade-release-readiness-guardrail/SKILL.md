---
name: l2-upgrade-release-readiness-guardrail
description: Gate TokamakL2JS upgrade releases before npm publish. Use when versioning, preparing release commits, updating build/package metadata, or publishing changes that may affect downstream integrators.
---

# Release Readiness Guardrail

Use this workflow to stop unsafe releases and enforce upgrade discipline.

## 1. Confirm release inputs

1. Confirm intended semver bump in `package.json`.
2. Confirm API impact report from `l2-upgrade-public-api-guardrail` is available.
3. Confirm no unresolved blocker in task review notes.

## 2. Validate package integrity

1. Run `npm run build`.
2. Run `npm pack --dry-run`.
3. Confirm published artifact contains expected files and no accidental internals.

## 3. Validate module entry compatibility

1. Confirm `main`, `types`, and `exports` all resolve to built outputs.
2. Confirm ESM/CJS artifacts are generated as expected.

## 4. Validate consumer-facing readiness

1. Confirm examples/configs still match exported type contracts.
2. Confirm migration notes exist when behavior is intentionally changed.

## 5. Emit release gate decision

1. Produce pass/fail summary with:
- semver justification
- build/package verification result
- downstream risk notes
2. Block publish until all failures are resolved.
