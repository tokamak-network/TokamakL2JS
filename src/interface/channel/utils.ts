import { MerklePatriciaTrie } from "@ethereumjs/mpt";
import { RLP } from "@ethereumjs/rlp";
import {
  addHexPrefix,
  Address,
  bytesToHex,
  createAddressFromString,
  hexToBytes,
  MapDB,
  unpadBytes,
} from "@ethereumjs/util";
import { createTokamakL2Common } from "../../common/index.js";
import {
  StateSnapshot,
  StorageEntriesJson,
} from "./types.js";

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

function getStorageTrieKeyPrefix(snapshot: StateSnapshot, storageAddressIndex: number): Uint8Array | undefined {
  const rootHexWithoutPrefix = addHexPrefix(snapshot.storageTrieRoots[storageAddressIndex]).slice(2);
  for (const entry of snapshot.storageTrieDb[storageAddressIndex]) {
    const dbKeyWithoutPrefix = addHexPrefix(entry.key).slice(2);
    if (dbKeyWithoutPrefix === rootHexWithoutPrefix) {
      return undefined;
    }
    if (dbKeyWithoutPrefix.endsWith(rootHexWithoutPrefix)) {
      const keyPrefixHex = dbKeyWithoutPrefix.slice(0, dbKeyWithoutPrefix.length - rootHexWithoutPrefix.length);
      return keyPrefixHex.length === 0 ? undefined : hexToBytes(addHexPrefix(keyPrefixHex));
    }
  }

  if (snapshot.storageTrieDb[storageAddressIndex].length === 0) {
    return undefined;
  }

  throw new Error(
    `Storage trie root ${snapshot.storageTrieRoots[storageAddressIndex]} does not have a matching trie DB entry at index ${storageAddressIndex}`,
  );
}

async function createStorageTrieFromSnapshot(
  snapshot: StateSnapshot,
  storageAddressIndex: number,
): Promise<MerklePatriciaTrie> {
  const trie = new MerklePatriciaTrie({
    useKeyHashing: true,
    common: createTokamakL2Common(),
    keyPrefix: getStorageTrieKeyPrefix(snapshot, storageAddressIndex),
    db: new MapDB<string, Uint8Array>(),
  });

  const trieDbOps = snapshot.storageTrieDb[storageAddressIndex].map((entry) => ({
    type: "put" as const,
    key: addHexPrefix(entry.key).slice(2),
    value: hexToBytes(addHexPrefix(entry.value)),
  }));
  await trie.database().db.batch(trieDbOps);
  trie.root(hexToBytes(addHexPrefix(snapshot.storageTrieRoots[storageAddressIndex])));

  return trie;
}

async function readStorageValueFromTrie(trie: MerklePatriciaTrie, storageKey: Uint8Array | string): Promise<string> {
  const normalizedStorageKey =
    typeof storageKey === "string" ? hexToBytes(addHexPrefix(storageKey)) : storageKey;
  const encodedValue = await trie.get(normalizedStorageKey);
  const decodedValue = encodedValue === null ? new Uint8Array() : (RLP.decode(encodedValue) as Uint8Array);
  return bytesToHex(unpadBytes(decodedValue));
}

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
    const entriesForAddress = await Promise.all(
      storageKeys.map(async (storageKey) => ({
        key: addHexPrefix(storageKey),
        value: await readStorageValueFromTrie(trie, storageKey),
      })),
    );
    storageEntries.push(entriesForAddress);
  }

  return storageEntries;
}
