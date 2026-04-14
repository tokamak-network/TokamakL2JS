import { IMTNode } from "@zk-kit/imt";
import { addHexPrefix, hexToBigInt } from "@ethereumjs/util";
import { StateSnapshot } from "../interface/channel/types.js";
import { MAX_MT_LEAVES } from "../interface/params/stateManager.js";

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
