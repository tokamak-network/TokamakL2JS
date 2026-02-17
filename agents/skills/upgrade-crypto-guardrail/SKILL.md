---
name: upgrade-crypto-guardrail
description: Guard `src/crypto/` upgrade safety in TokamakL2JS. Use when changing Poseidon hashing, EDDSA sign/verify behavior, public key recovery behavior, or crypto API contracts exported through `src/index.ts`.
---

# Crypto Guardrail

Use this skill to prevent cryptographic behavior drift.

## Quick Start

```bash
npm run build
node agents/skills/upgrade-crypto-guardrail/scripts/crypto-smoke.mjs
```

## What the Smoke Check Verifies

1. Fixed-vector key derivation remains deterministic.
2. Fixed-vector `poseidon_raw` output remains stable.
3. Fixed-vector `poseidon(empty)` output remains stable.
4. EDDSA sign/verify works for fixed message and fixed key.
5. `poseidon_raw` still rejects invalid arity.

## Workflow

1. Run smoke script before and after changes under `src/crypto/`.
2. Treat any vector mismatch or verification failure as blocking.
3. Run `npm run build` and block merge on failure.

## Reporting

Capture:
- changed files under `src/crypto/`
- smoke script pass/fail
- intentional crypto behavior changes and migration implications

Use expected vectors in `references/test-vectors.md`.
