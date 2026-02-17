---
name: l2-upgrade-tx-crypto-guardrail
description: Guard transaction and cryptography behavior for TokamakL2JS upgrades. Use when changing `TokamakL2Tx`, tx constructors/serialization, EDDSA signing and verification flow, Poseidon hashing behavior, or sender key/address derivation logic.
---

# Tx/Crypto Guardrail

Use this workflow to prevent signature, serialization, and address-derivation regressions.

## 1. Scope behavior-critical changes

1. Inspect diffs in `src/tx/`, `src/crypto/`, and related helpers in `src/utils/`.
2. Mark changes touching message layout, raw encoding, signing, verification, or sender recovery.

## 2. Preserve transaction wire compatibility

1. Keep tx raw field ordering and count stable.
2. Keep RLP decode/encode round-trip behavior stable for valid payloads.
3. Keep constructor validation semantics stable unless explicit migration is planned.

## 3. Preserve signature semantics

1. Keep message-to-sign layout deterministic.
2. Keep `sign -> verifySignature -> getSenderAddress` round-trip behavior consistent.
3. Keep sender public key initialization constraints and mismatch checks intact.

## 4. Preserve cryptographic interface contracts

1. Keep Poseidon input contract explicit and validated.
2. Keep EDDSA failure modes explicit for invalid key/range/signature inputs.
3. Block changes that silently alter accepted input domains.

## 5. Validate and report

1. Run `npm run build`.
2. Report:
- compatibility impact (`breaking`/`additive`/`internal`)
- changed validation rules
- pass/fail decision with required migration notes
