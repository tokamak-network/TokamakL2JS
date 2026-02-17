---
name: upgrade-tx-guardrail
description: Guard `src/tx/` upgrade safety in TokamakL2JS. Use when changing `TokamakL2Tx`, tx constructors, tx types, serialization layout, message-to-sign construction, sender recovery flow, or tx validation behavior.
---

# Tx Guardrail

Use this skill to block transaction serialization and signature-flow regressions.

## Quick Start

```bash
npm run build
node agents/skills/upgrade-tx-guardrail/scripts/tx-smoke.mjs
```

## What the Smoke Check Verifies

1. `createTokamakL2Tx -> sign -> verifySignature` success path.
2. Sender address recovery consistency.
3. Deterministic RLP serialization for a fixed tx vector.
4. RLP round-trip via `createTokamakL2TxFromRLP`.

## Workflow

1. Run smoke script before and after changes under `src/tx/`.
2. Treat sender mismatch, serialization mismatch, or round-trip mismatch as blocking.
3. Run `npm run build` and block merge on failure.

## Reporting

Capture:
- changed files under `src/tx/`
- smoke script pass/fail
- intentional behavior changes and required migration notes

Use acceptance checks in `references/acceptance-checks.md`.
