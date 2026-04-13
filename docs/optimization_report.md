# Optimization Report for `initTokamakExtends*`

## Purpose

This document records the optimization work performed for:

- `TokamakL2StateManager.initTokamakExtendsFromSnapshot()`
- `TokamakL2StateManager.initTokamakExtendsFromRPC()`

It summarizes which ideas were tested, which ones were rejected, which ones were
adopted, and what the current performance characteristics look like.

## Current Status

The current codebase already includes the following accepted changes:

1. Dense `IMT`-backed storage trees were replaced with `TokamakSparseMerkleTree`.
2. `StateSnapshot` was redesigned to preload storage MPT state using:
   - `storageKeys`
   - `storageTrieRoots`
   - `storageTrieDb`
3. `initTokamakExtendsFromSnapshot()` no longer rebuilds the storage trie with
   repeated `storageTrie.put()` calls.
4. `TokamakSparseMerkleTree.batchUpdate()` was added and the init path now uses
   batched Merkle updates instead of per-entry `update()` calls.

Legacy comparison benchmark scripts were removed after the batch-update result was
confirmed, so this report preserves the important benchmark numbers.

## Accepted Optimizations

### 1. Sparse deterministic-index Merkle tree

The previous implementation paid a large depth-dependent cost because it built a
dense `IMT` with:

```ts
Array(MAX_MT_LEAVES).fill(NULL_LEAF)
```

This was replaced with `TokamakSparseMerkleTree`, which:

- preserves deterministic leaf indexing based on `key % MAX_MT_LEAVES`
- stores only explicitly touched nodes
- keeps root/proof behavior compatible with current `IMTMerkleProof` usage

Effect:

- initialization time is no longer strongly coupled to `MT_DEPTH`
- the dominant cost moved toward storage-entry count rather than tree capacity

### 2. Preloaded storage trie snapshots

`StateSnapshot` used to carry `storageEntries[{ key, value }]`.
That format forced `initTokamakExtendsFromSnapshot()` to execute repeated
storage-trie writes during reconstruction.

The current snapshot format stores:

- `storageKeys`
- `storageTrieRoots`
- `storageTrieDb`

This allows snapshot initialization to:

1. preload trie nodes into the account trie DB
2. assign the known storage root to the account
3. read values back through the trie using `storageKeys`

Effect:

- the expensive repeated `storageTrie.put()` loop was removed from the snapshot path

### 3. Batched sparse Merkle updates

Even after preloading the storage trie, the snapshot init path still performed:

- one `merkleTrees.update(...)` call per storage entry

That meant recomputing ancestors repeatedly for overlapping paths.

`TokamakSparseMerkleTree.batchUpdate()` now:

- applies all changed leaves first
- recomputes only the affected parent indices at each level
- performs one upward pass per level for the changed frontier

The snapshot and RPC init paths now use batched updates for per-address Merkle
reconstruction.

## Rejected or Ineffective Optimizations

The following ideas were tested earlier and did not produce useful end-to-end
improvement:

### 1. Optional flush suppression in `putStorage()`

Idea:

- call `putStorage(..., false)` during init
- `flush()` once at the end

Result:

- no meaningful speedup in practice

Reason:

- trie writes, not `flush()` call count, dominated runtime

### 2. `O(1)` collision tracking with reverse leaf-index maps

Idea:

- maintain `leafIndex -> key` in addition to `key -> leafIndex`

Result:

- useful for cleaner logic and worst-case behavior
- not a meaningful end-to-end speed optimization

### 3. Init-path bypass of the public `putStorage()` wrapper

Idea:

- avoid wrapper overhead
- update internal structures more directly during init

Result:

- no meaningful improvement by itself

Reason:

- wrapper overhead was not the bottleneck

## Bottleneck Analysis

Before the accepted optimizations were applied, the main snapshot-init bottlenecks
were measured as:

- repeated `storageTrie.put(...)` calls
- repeated `merkleTrees.update(...)` calls

Further inspection showed:

- `RLP.encode(...)` was not a bottleneck
- the actual cost was the trie `put()` itself

After moving to preloaded trie snapshots, the dominant remaining cost became the
Tokamak storage Merkle reconstruction. That is what motivated `batchUpdate()`.

## Snapshot Format Trade-Offs

The preloaded-trie snapshot format improves runtime but makes snapshots larger.

A previous measurement with JSON hex encoding showed that adding full storage MPT
data can increase snapshot size by roughly one order of magnitude or more.

A later compression idea was considered:

- remove `storageTrieDb[*].key`
- keep only encoded node values
- recompute DB keys during init

This was rejected.

Reason:

- rebuilding DB keys requires hashing every trie node again
- with the current crypto stack, that reintroduced a large init-time cost
- in a measured synthetic case with 4096 storage entries and 20516 trie nodes,
  recomputing keys added about `24.65s`

Conclusion:

- `storageTrieDb.key` should remain present in the snapshot format

## Key Benchmark Results

### 1. Snapshot init after sparse tree + preloaded trie + batch update

The current implementation was measured sequentially with:

- `warmup = 0`
- `repeats = 1`
- no parallel execution
- synthetic shape: `1` storage address, `1` contract code entry, non-zero 32-byte values

Results:

| MT_DEPTH | MAX_MT_LEAVES | storageEntries | time (s) |
| --- | ---: | ---: | ---: |
| 24 | 16777216 | 512 | 0.297 |
| 24 | 16777216 | 1024 | 0.521 |
| 24 | 16777216 | 2048 | 1.046 |
| 24 | 16777216 | 4096 | 2.039 |
| 24 | 16777216 | 8192 | 4.042 |
| 30 | 1073741824 | 512 | 0.258 |
| 30 | 1073741824 | 1024 | 0.550 |
| 30 | 1073741824 | 2048 | 0.809 |
| 30 | 1073741824 | 4096 | 2.102 |
| 30 | 1073741824 | 8192 | 4.025 |
| 36 | 68719476736 | 512 | 0.168 |
| 36 | 68719476736 | 1024 | 0.542 |
| 36 | 68719476736 | 2048 | 1.033 |
| 36 | 68719476736 | 4096 | 2.059 |
| 36 | 68719476736 | 8192 | 4.092 |
| 42 | 4398046511104 | 512 | 0.260 |
| 42 | 4398046511104 | 1024 | 0.526 |
| 42 | 4398046511104 | 2048 | 1.023 |
| 42 | 4398046511104 | 4096 | 2.080 |
| 42 | 4398046511104 | 8192 | 4.106 |

Interpretation:

- runtime is now dominated primarily by `storageEntries`
- `MT_DEPTH` has only a small effect in the tested range
- the growth with respect to `storageEntries` is close to linear

### 2. Effect of `batchUpdate()` alone

The `batchUpdate()` change was measured directly against the immediately previous
revision under:

- `MT_DEPTH = 30`
- `storageEntries = 4096`
- `warmup = 1`
- `repeats = 3`
- sequential execution only

Results:

| Revision | avg s | min s | max s |
| --- | ---: | ---: | ---: |
| pre-batch `838765c` | 29.052 | 28.946 | 29.170 |
| post-batch `88d850d` | 2.156 | 2.118 | 2.194 |

Interpretation:

- `batchUpdate()` reduced the measured runtime by about `13.47x`
- the per-entry repeated Merkle ancestor recomputation had been a dominant bottleneck

## Current Practical Conclusion

At this point the initialization bottlenecks have shifted:

- `MT_DEPTH` is no longer the main problem
- per-entry storage scaling is much better than before, but still not free
- current runtime is mostly shaped by the number of storage entries

The largest accepted wins came from:

1. sparse deterministic-index Merkle trees
2. preloaded storage-trie snapshots
3. batched sparse Merkle reconstruction

## Remaining Future Work

If initialization is revisited again, the remaining questions are no longer about
depth scaling. The next meaningful targets would be:

1. snapshot size reduction without reintroducing hash-heavy reconstruction costs
2. faster snapshot serialization/deserialization formats than JSON hex
3. further reducing the per-entry cost of storage-key iteration and trie reads, if
   that ever becomes material in larger real-world workloads

## Final Statement

This repository is no longer on the old unoptimized baseline for this line of
investigation.

The currently checked-in code already includes the main successful optimizations for
`initTokamakExtendsFromSnapshot()`.
