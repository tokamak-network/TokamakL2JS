---
name: l2-upgrade-tx-crypto-guardrail
description: Guard transaction and cryptography behavior for TokamakL2JS upgrades. Use when changing `TokamakL2Tx`, tx constructors/serialization, EDDSA signing and verification flow, Poseidon hashing behavior, or sender key/address derivation logic.
---

# Tx/Crypto Guardrail

Use this skill to block signature, serialization, and address-derivation regressions.

## Quick Start

```bash
npm run build
node agents/skills/l2-upgrade-tx-crypto-guardrail/scripts/tx-crypto-smoke.mjs
```

## What the Smoke Check Verifies

1. Deterministic key derivation from fixed signatures.
2. `createTokamakL2Tx -> sign -> verifySignature` happy-path success.
3. `getSenderAddress()` equals address derived from sender public key.
4. RLP serialization round-trip with `createTokamakL2TxFromRLP`.
5. `poseidon_raw` rejects invalid input length.
6. `poseidon(new Uint8Array())` returns 32-byte digest.

## Workflow

1. Run smoke script before and after tx/crypto changes.
2. If smoke output differs, inspect:
- tx raw ordering
- message-to-sign construction
- EDDSA signature and verification path
- sender pubkey recovery assumptions
3. Treat any round-trip or sender-address mismatch as blocking.

## Reporting

Capture:
- smoke script pass/fail
- changed files under `src/tx/`, `src/crypto/`, `src/utils/`
- intentional behavior changes and required migration note

Use acceptance expectations in `references/acceptance-checks.md`.
