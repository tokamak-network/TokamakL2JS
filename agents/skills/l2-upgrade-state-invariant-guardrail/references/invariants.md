# Invariants

## Structural

- `storageAddresses`, `registeredKeys`, `storageEntries`, `preAllocatedLeaves`, `stateRoots` must have equal length.
- Every storage address must be unique.
- Each address must have exactly one aligned index across all arrays.

## Key Membership

- For each address index:
`registeredKeys[index]` must match the union of keys from
`storageEntries[index]` and `preAllocatedLeaves[index]`.
- No key should be lost when converting between snapshot and state-manager memory model.

## Runtime Guard Intent

- Snapshot root mismatch must fail initialization.
- Missing address lookup must produce deterministic sentinel `[-1, -1]`.
- Invalid snapshot shapes must fail before mutating state.
