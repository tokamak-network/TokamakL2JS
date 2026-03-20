import { Common } from "@ethereumjs/common";
import { Address } from "@ethereumjs/util";

export type MerkleTreeMembers = Map<bigint, Map<bigint, bigint>>;   // Map<address, Map<storageKey, value>>

export type storageKeysForAddress = {
    address: Address,
    keyPairs: {
        L1: Uint8Array,
        L2: Uint8Array,
    }[]
};
export type contractCodeForAddress = {
    address: Address,
    code: `0x${string}`,
};

export type TokamakL2StateManagerRPCOpts = {
    common: Common,
    storageAddresses: Address[],
    blockNumber: number,
    callCodeAddresses: Address[],
    initStorageKeys: storageKeysForAddress[],
}

export type TokamakL2StateManagerSnapshotOpts = {
    common: Common,
    contractCodes?: contractCodeForAddress[]
}
