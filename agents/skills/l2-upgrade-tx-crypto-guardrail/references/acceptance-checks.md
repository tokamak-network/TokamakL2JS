# Acceptance Checks

## Transaction Path

- `createTokamakL2Tx` must accept valid tx data and produce signable instance.
- `sign()` must produce tx that passes `verifySignature()`.
- `getSenderAddress()` must match address derived from initialized sender pubkey.
- `serialize()` output must round-trip through `createTokamakL2TxFromRLP`.

## Crypto Path

- `poseidon_raw` must reject wrong input arity.
- `poseidon` must produce 32-byte output for empty input.
- EDDSA key derivation and signing flow must remain deterministic for fixed signatures.
