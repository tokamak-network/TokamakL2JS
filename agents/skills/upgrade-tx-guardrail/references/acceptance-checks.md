# Acceptance Checks

## Transaction Path

- `createTokamakL2Tx` must produce a signable tx for valid inputs.
- `sign()` output must pass `verifySignature()`.
- `getSenderAddress()` must match address derived from initialized sender pubkey.
- `serialize()` output must round-trip through `createTokamakL2TxFromRLP`.
- Fixed tx vector serialization must remain stable unless an explicit breaking change is approved.
