# Optimization Report for `initTokamakExtends*`

## Purpose

This document records the optimization ideas, measurements, and conclusions discussed for
`TokamakL2StateManager.initTokamakExtendsFromSnapshot()` and
`TokamakL2StateManager.initTokamakExtendsFromRPC()`.

It is a reference note only. These optimizations are not intended to be applied to
remote `main` at this time.

## Scope

The discussion focused on initialization cost when reconstructing state from:

- `StateSnapshot`
- L1 RPC storage reads

The main code paths investigated were:

- repeated calls to `putStorage()`
- repeated `MerkleStateManager` storage trie writes
- dense `IMT` construction using `Array(MAX_MT_LEAVES).fill(NULL_LEAF)`

## Measurement Notes

Unless stated otherwise, the benchmark target was:

- `createTokamakL2StateManagerFromStateSnapshot()`
- measured scope: `initTokamakExtendsFromSnapshot()` path only
- synthetic shape: `1` storage address, `1` contract code entry, unique storage keys, non-zero values

Important caveats:

- Many early measurements used `repeats=1` and `warmup=0`.
- Some early comparisons were run in parallel on the same machine and are noisy.
- Sequential measurements are more trustworthy than parallel measurements, but they are still
  not rigorous microbenchmarks because they also used `repeats=1`.

Confidence levels in this report:

- `Low`: noisy or parallel measurements
- `Medium`: sequential measurements, but still single-run
- `High`: not reached in this investigation

## Current Baseline Observations

### Initialization scaling

Earlier broad snapshot measurements showed that initialization time increases steeply with both
`MT_DEPTH` and the number of storage entries.

Representative results from the previously used matrix:

| MT_DEPTH | ratio | storageEntries | time |
| --- | --- | ---: | ---: |
| 12 | 10% | 409 | 4.129s |
| 12 | 25% | 1024 | 10.446s |
| 12 | 50% | 2048 | 21.472s |
| 12 | 75% | 3072 | 32.863s |
| 12 | 100% | 4096 | 44.794s |
| 13 | 10% | 819 | 9.073s |
| 13 | 25% | 2048 | 22.006s |
| 13 | 50% | 4096 | 46.168s |
| 13 | 75% | 6144 | 80.503s |
| 13 | 100% | 8192 | 96.273s |
| 14 | 10% | 1638 | 19.180s |
| 14 | 25% | 4096 | 47.920s |
| 14 | 50% | 8192 | unknown (>120s) |

Interpretation:

- `storageEntries` behaves close to linear for fixed depth.
- `MT_DEPTH` is expensive because `MAX_MT_LEAVES = 2^MT_DEPTH`.
- The current implementation pays both:
  - dense tree construction cost
  - per-slot storage trie write cost

### Dense `IMT` constructor cost

The dense constructor cost was measured separately for:

```ts
new IMT(..., Array(MAX_MT_LEAVES).fill(NULL_LEAF))
```

Representative results:

| MT_DEPTH | constructor time |
| --- | ---: |
| 12 | 0.615s |
| 13 | 1.217s |
| 14 | 2.457s |
| 15 | 4.814s |
| 16 | 9.642s |
| 17 | 19.227s |
| 18 | 39.346s |

Interpretation:

- Dense `IMT` construction is a real cost.
- It is not the only cost.
- Any optimization that removes this constructor cost alone is unlikely to be enough.

## Attempted Optimizations

### 1. Optional flush flag in `putStorage()`

Idea:

- add `putStorage(address, key, value, flush = true)`
- call `putStorage(..., false)` during init loops
- call `flush()` once at the end

Why it seemed promising:

- the original init path called `putStorage()` in a loop
- `putStorage()` itself called `await this.flush()`

Observed result:

- no clear benefit in the benchmark
- practical effect appeared negligible

Confidence:

- `Low`

Reason for low confidence:

- the direct before/after benchmark for this change was not measured under a strict setup
- however, no evidence of meaningful improvement was found

Current conclusion:

- this optimization is not worth adopting based on current evidence

### 2. `O(1)` collision tracking with reverse leaf-index map

Idea:

- maintain `leafIndex -> key` in addition to `key -> leafIndex`
- replace full scans during collision checks with direct lookup

Why it seemed promising:

- current collision detection in `putStorage()` scanned existing keys for the same address

Observed result:

- practical effect on end-to-end init time was negligible

Additional verification:

- behavior was checked against the previous implementation
- snapshot init result, RPC init result, and collision error behavior matched the baseline

Confidence:

- `Medium` for behavioral equivalence
- `Low` for exact speedup estimate

Current conclusion:

- acceptable as a code-structure improvement
- not meaningful as a performance optimization

### 3. Init path bypass of public `putStorage()`

Idea:

- keep public API unchanged
- update internal maps and Merkle trees directly during init
- call `super.putStorage()` directly instead of routing through the public wrapper

Observed result:

- practical effect on end-to-end init time was negligible

Interpretation:

- wrapper overhead is small compared with the actual trie write cost

Confidence:

- `Low`

Current conclusion:

- not useful as a standalone optimization

## Bulk Storage Trie Write Prototype

### Idea

Use `MerkleStateManager` protected internals to batch storage writes per address:

- call `getAccount(address)` once
- call `_modifyContractStorage(address, account, ...)` once
- apply many storage trie `put()` operations to the same `storageTrie`
- update `storageRoot` and `putAccount()` once per address instead of once per slot

This does not rely on `dumpStorage()` or `dumpStorageRange()`.
It relies on already having original storage keys and values.

### Why this was investigated

This is a lower-level optimization than the flush and wrapper changes.
It reduces repeated account-level trie work.

### Measured Result

An isolated prototype was created in a temporary worktree.
The prototype was benchmarked against current code.

Early comparison result:

| MT_DEPTH | ratio | baseline | bulk prototype | speedup |
| --- | --- | ---: | ---: | ---: |
| 12 | 25% | 8.274s | 6.965s | 1.19x |
| 12 | 50% | 17.327s | 14.658s | 1.18x |
| 12 | 100% | 36.004s | 30.778s | 1.17x |
| 13 | 25% | 17.757s | 15.283s | 1.16x |
| 13 | 50% | 37.266s | 31.795s | 1.17x |
| 13 | 100% | 78.064s | 68.139s | 1.15x |

Confidence:

- `Low`

Reason:

- measured with single-run, non-rigorous comparison

Current conclusion:

- likely provides a real but modest gain
- not enough on its own to solve the problem

## Sparse Merkle Tree plus Bulk Storage Trie Write Prototype

### Combined idea

Apply both:

- replace dense `IMT` usage with a sparse deterministic-index Merkle tree implementation
- use address-level bulk storage trie writes

The sparse tree preserved:

- deterministic leaf index based on `key % MAX_MT_LEAVES`
- root retrieval
- proof shape compatible with current `IMTMerkleProof` usage

### Earlier comparison

An earlier comparison suggested improvement, but it was not trustworthy enough because
baseline and prototype measurements had inconsistent baselines.

That result should not be treated as reliable.

Confidence:

- `Low`

### Sequential comparison without parallel execution

A second comparison was performed sequentially:

1. benchmark current code alone
2. benchmark sparse+bulk prototype alone

Conditions:

- `MT_DEPTH=12,13`
- ratio `25%, 50%, 100%`
- `repeats=1`
- `warmup=0`

Results:

| MT_DEPTH | ratio | current `61bb8cd` | sparse+bulk prototype | speedup |
| --- | --- | ---: | ---: | ---: |
| 12 | 25% | 9.940s | 7.620s | 1.30x |
| 12 | 50% | 20.614s | 16.920s | 1.22x |
| 12 | 100% | 43.563s | 37.101s | 1.17x |
| 13 | 25% | 21.828s | 17.449s | 1.25x |
| 13 | 50% | 45.109s | 37.775s | 1.19x |
| 13 | 100% | 94.666s | 81.658s | 1.16x |

Confidence:

- `Medium`

Reason:

- sequential comparison removed the parallel-execution flaw
- still only single-run and no warmup

Current conclusion:

- this combined approach appears to produce a real improvement
- the gain is meaningful but not dramatic
- expected improvement appears to be roughly `1.16x` to `1.30x` in the tested range

## Export / Import Investigation

The following `MerkleStateManager` APIs were inspected:

- `dumpStorage(address)`
- `dumpStorageRange(address, startKey, limit)`

Key findings:

- they export hashed storage trie keys, not original storage slot keys
- `dumpStorageRange()` does not provide usable key preimages in practice
- there is no public round-trip import API for this export format

Implication:

- these APIs are not suitable for efficiently reconstructing storage from exported data
- they do not remove the need to already know original storage keys

## What Failed

Based on the experiments so far, the following approaches did not show useful performance gains:

- optional flush suppression in `putStorage()`
- `O(1)` collision map
- bypassing public `putStorage()` during init while keeping the same underlying write pattern

These are not necessarily wrong changes, but they do not address the dominant cost.

## What Still Looks Plausible

Based on current evidence, the only optimization direction that showed clear improvement was:

- address-level bulk storage trie writes

And the strongest combined result came from:

- sparse deterministic-index Merkle tree
- address-level bulk storage trie writes

However:

- the gain is moderate, not transformative
- no optimization investigated so far justifies merging into remote `main`

## Recommendation for Future Revisit

If this topic is revisited later:

1. Start from the sequential sparse+bulk result, not from the earlier noisy runs.
2. Re-run the benchmark with a stricter method:
   - no parallel execution
   - `warmup >= 1`
   - `repeats >= 5`
   - compare medians, not only single timings
3. Validate correctness for:
   - snapshot root reconstruction
   - RPC and snapshot equivalence
   - collision behavior
   - Merkle proof compatibility
4. Only consider production adoption if the stricter benchmark confirms the gain and the
   implementation complexity is acceptable.

## Final Status

No optimization from this investigation is currently applied to the checked-in code path.

The repository remains on the unoptimized baseline for this line of investigation.
