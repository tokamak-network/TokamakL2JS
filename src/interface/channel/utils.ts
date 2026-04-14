import {
  Address,
  createAddressFromString,
} from "@ethereumjs/util";
import {
  StateSnapshot,
  StorageEntriesJson,
} from "./types.js";
import {
  createStorageTrieFromSnapshot,
  readStorageEntriesFromStorageTrie,
  readStorageValueFromTrie,
} from "../../stateManager/utils.js";

function getStorageAddressIndex(snapshot: StateSnapshot, storageAddress: Address | string): number {
  if (
    snapshot.storageAddresses.length !== snapshot.storageKeys.length ||
    snapshot.storageAddresses.length !== snapshot.storageTrieRoots.length ||
    snapshot.storageAddresses.length !== snapshot.storageTrieDb.length
  ) {
    throw new Error("StateSnapshot storage arrays must have the same length")
  }

  const normalizedAddress =
    typeof storageAddress === "string"
      ? createAddressFromString(storageAddress).toString()
      : storageAddress.toString();
  const index = snapshot.storageAddresses.indexOf(normalizedAddress);

  if (index === -1) {
    throw new Error(`Storage address ${normalizedAddress} does not exist in the StateSnapshot`)
  }

  return index;
}

export { readStorageEntriesFromStorageTrie } from "../../stateManager/utils.js";

export async function readStorageValueFromStateSnapshot(
  snapshot: StateSnapshot,
  storageAddress: Address | string,
  storageKey: Uint8Array | string,
): Promise<string> {
  const storageAddressIndex = getStorageAddressIndex(snapshot, storageAddress);
  const trie = await createStorageTrieFromSnapshot(snapshot, storageAddressIndex);
  return readStorageValueFromTrie(trie, storageKey);
}

export async function readStorageEntriesFromStateSnapshot(
  snapshot: StateSnapshot,
): Promise<StorageEntriesJson> {
  const storageEntries: StorageEntriesJson = [];

  for (const [storageAddressIndex, storageKeys] of snapshot.storageKeys.entries()) {
    const trie = await createStorageTrieFromSnapshot(snapshot, storageAddressIndex);
    const entriesForAddress = await readStorageEntriesFromStorageTrie(storageKeys, trie);
    storageEntries.push(entriesForAddress);
  }

  return storageEntries;
}
