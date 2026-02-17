---
name: upgrade-block-guardrail
description: Guard `src/block/` upgrade safety in TokamakL2JS. Use when changing block constructors/types, tx-to-block assembly behavior, header-to-tx gasLimit propagation, or block creation interfaces exported through `src/index.ts`.
---

# Block Guardrail

Use this skill to block regressions in block assembly behavior.

## Quick Start

```bash
npm run build
node agents/skills/upgrade-block-guardrail/scripts/block-smoke.mjs
```

## What the Smoke Check Verifies

1. `createTokamakL2Block` constructs a block with expected tx count.
2. Header gasLimit is propagated into tx gasLimit.
3. Fixed-vector block hash remains stable.
4. Missing `common.customCrypto` path still fails fast.

## Workflow

1. Run smoke script before and after changes under `src/block/`.
2. Treat gasLimit propagation mismatch, block hash drift, or missing-fast-fail behavior as blocking.
3. Run `npm run build` and block merge on failure.

## Reporting

Capture:
- changed files under `src/block/`
- smoke script pass/fail
- intentional behavior changes and migration notes

Use expected behavior checklist in `references/acceptance-checks.md`.
