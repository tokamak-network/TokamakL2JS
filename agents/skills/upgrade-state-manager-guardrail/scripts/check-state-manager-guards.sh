#!/usr/bin/env bash
set -euo pipefail

TARGET_FILE="${1:-src/stateManager/TokamakL2StateManager.ts}"

if [[ ! -f "${TARGET_FILE}" ]]; then
  echo "Target file not found: ${TARGET_FILE}" >&2
  exit 1
fi

declare -a CHECKS=(
  "snapshot.storageAddresses.length !== snapshot.registeredKeys.length|snapshot registeredKeys length guard"
  "snapshot.storageAddresses.length !== snapshot.preAllocatedLeaves.length|snapshot preAllocatedLeaves length guard"
  "snapshot.storageAddresses.length !== snapshot.storageEntries.length|snapshot storageEntries length guard"
  "this._initialMerkleTrees.merkleTrees.some((tree, idx) => treeNodeToBigint(tree.root) !== hexToBigInt(addHexPrefix(snapshot.stateRoots[idx])))|snapshot root mismatch guard"
  "if (addressIndex === -1) {|missing-address leaf index guard"
  "return [-1, -1];|missing-address sentinel return"
)

missing=0
echo "Checking invariant guards in ${TARGET_FILE}"

for entry in "${CHECKS[@]}"; do
  pattern="${entry%%|*}"
  label="${entry##*|}"
  if rg -Fq "${pattern}" "${TARGET_FILE}"; then
    echo "[ok] ${label}"
  else
    echo "[missing] ${label}" >&2
    missing=$((missing + 1))
  fi
done

if [[ "${missing}" -gt 0 ]]; then
  echo "Invariant guard check failed (${missing} missing patterns)." >&2
  exit 2
fi

echo "Invariant guard check passed."
