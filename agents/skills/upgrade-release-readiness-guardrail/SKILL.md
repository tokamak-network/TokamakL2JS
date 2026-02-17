---
name: upgrade-release-readiness-guardrail
description: Gate TokamakL2JS upgrade releases before npm publish. Use when versioning, preparing release commits, updating build/package metadata, or publishing changes that may affect downstream integrators.
---

# Release Readiness Guardrail

Use this skill as the final pre-publish gate.

## Quick Start

```bash
bash agents/skills/upgrade-release-readiness-guardrail/scripts/release-readiness-gate.sh origin/main
```

This command runs:
- public API gate script
- state-manager guard script
- tx guard smoke script
- crypto guard smoke script
- `npm run build`
- `npm pack --dry-run`
- semver sanity check vs base ref

## Workflow

1. Choose base ref representing the latest released commit (tag or default branch).
2. Run `release-readiness-gate.sh <base-ref>`.
3. Review output artifacts in:
`agents/skills/upgrade-release-readiness-guardrail/out/`
4. Block release on any failure.

## Output Artifacts

- `public-api-report.md`
- `public-api-report.json`
- `npm-pack-dry-run.txt`
- `release-gate-summary.txt`

## Fail Conditions

- public API breaking changes without major version bump
- missing built entry files from pack output
- failing state/tx/crypto gates
- failing build or dry-run package step

Release policy reference: `references/release-policy.md`.
