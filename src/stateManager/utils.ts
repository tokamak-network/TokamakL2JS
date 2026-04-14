import { MerklePatriciaTrie } from "@ethereumjs/mpt";
import { RLP } from "@ethereumjs/rlp";
import { IMTNode } from "@zk-kit/imt";
import { addHexPrefix, Address, bytesToBigInt, bytesToHex, hexToBigInt, hexToBytes, MapDB, unpadBytes } from "@ethereumjs/util";
import { createTokamakL2Common } from "../common/index.js";
import { StateSnapshot, StorageEntryJson } from "../interface/channel/types.js";
import { MAX_MT_LEAVES } from "../interface/params/stateManager.js";
import { getStorageTrieKeyPrefix } from "../interface/channel/utils.js";

export const treeNodeToBigint = (node: IMTNode): bigint => {
    if (typeof node === "bigint") {
        return node;
    }
    if (typeof node === "string") {
        return hexToBigInt(addHexPrefix(node));
    }
    return BigInt(node);
};

export const assertStorageEntryCapacity = (entryCount: number, address: string): void => {
    if (entryCount > MAX_MT_LEAVES) {
        throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${entryCount} for address ${address}`)
    }
}

export const assertSnapshotStorageShape = (snapshot: StateSnapshot): void => {
    const addressCount = snapshot.storageAddresses.length
    if (
        snapshot.stateRoots.length !== addressCount ||
        snapshot.storageKeys.length !== addressCount ||
        snapshot.storageTrieRoots.length !== addressCount ||
        snapshot.storageTrieDb.length !== addressCount
    ) {
        throw new Error('Snapshot is expected to have storage keys, trie roots, and trie nodes for each state root')
    }
}

export const _normalizeStorageEntries = (entries: { key: Uint8Array, value: Uint8Array }[]): {
    key: Uint8Array,
    value: Uint8Array,
    keyBigInt: bigint,
    valueBigInt: bigint,
}[] => {
    return entries.map((entry) => {
        const normalizedValue = unpadBytes(entry.value)

        return {
            key: entry.key,
            value: normalizedValue,
            keyBigInt: bytesToBigInt(entry.key),
            valueBigInt: normalizedValue.length === 0 ? 0n : bytesToBigInt(normalizedValue),
        }
    })
}

export const deriveStorageTrieKeyPrefix = (
    prefixStorageTrieKeys: boolean,
    address: Address,
    keccak256: ((msg: Uint8Array) => Uint8Array) | undefined,
): Uint8Array | undefined => {
    if (!prefixStorageTrieKeys) {
        return undefined;
    }
    if (keccak256 === undefined) {
        throw new Error("customCrypto.keccak256 must be defined when storage trie key prefixing is enabled");
    }

    const addressBytes = keccak256(address.bytes);
    return addressBytes.slice(0, 7);
}

export const createStorageTrieFromSnapshot = async (
    snapshot: StateSnapshot,
    storageAddressIndex: number,
): Promise<MerklePatriciaTrie> => {
    const common = createTokamakL2Common();
    const trie = new MerklePatriciaTrie({
        useKeyHashing: true,
        common,
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

export const readStorageValueFromTrie = async (
    trie: MerklePatriciaTrie,
    storageKey: Uint8Array | string,
): Promise<string> => {
    const normalizedStorageKey =
        typeof storageKey === "string" ? hexToBytes(addHexPrefix(storageKey)) : storageKey;
    const encodedValue = await trie.get(normalizedStorageKey);
    const decodedValue = encodedValue === null ? new Uint8Array() : (RLP.decode(encodedValue) as Uint8Array);
    return bytesToHex(unpadBytes(decodedValue));
}

export const readStorageEntriesFromStorageTrie = async (
    storageKeys: string[],
    storageTrie: MerklePatriciaTrie,
): Promise<StorageEntryJson[]> => {
    return Promise.all(
        storageKeys.map(async (storageKey) => ({
            key: addHexPrefix(storageKey),
            value: await readStorageValueFromTrie(storageTrie, storageKey),
        })),
    );
}
