# Release Policy

## Required Gate Sequence

1. Public API report and severity classification.
2. State guard checks.
3. Build and tx/crypto smoke checks.
4. `npm pack --dry-run` artifact inspection.
5. Semver consistency with API severity.

## Semver Rule

- Breaking API deltas require major version bump.
- Additive-only deltas can use minor/patch based on release policy.
- Version decreases are invalid.

## Publish Blockers

- Any non-zero gate exit.
- Missing `dist/index.js`, `dist/index.d.ts`, or `dist/cjs/index.js` from pack dry-run output.
- Unresolved migration notes for intentional behavior changes.
