# Release Policy

## Required Gate Sequence

1. Remote-main sync check (`HEAD` must equal latest `origin/main`).
2. Public API report and severity classification.
3. State guard checks.
4. Build and tx/crypto smoke checks.
5. `npm pack --dry-run` artifact inspection.
6. Semver consistency with API severity.

## Semver Rule

- Breaking API deltas require major version bump.
- Additive-only deltas can use minor/patch based on release policy.
- Publish attempts must bump `package.json` version vs base ref.
- When version is bumped, commit history must include subject:
`NPM version upgrade to <version>`.
- Version decreases are invalid.

## Publish Blockers

- Any non-zero gate exit.
- Local `HEAD` diverges from latest `origin/main`.
- Missing `dist/index.js`, `dist/index.d.ts`, or `dist/cjs/index.js` from pack dry-run output.
- Unresolved migration notes for intentional behavior changes.
