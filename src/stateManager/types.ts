import { Common } from "@ethereumjs/common";
import { Address } from "@ethereumjs/util";
import { IMT } from "@zk-kit/imt";

export type MerkleTreeLeavesForAddress = {address: Address, leaves: bigint[]};
export type MerkleTreeMembers = Map<bigint, Map<bigint, bigint>>;
export type RegisteredKeysForAddress = {address: Address, keys: Uint8Array[]};
export type TrackedStorageKeysForAddress = {
    address: Address,
    keys: Map<bigint, `0x${string}`>,
};

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

export type TokamakL2StateManagerOpts = {
    common: Common,
    initStorageKeys?: storageKeysForAddress[],
    storageAddresses?: Address[],
    blockNumber?: number,
    contractCodes?: contractCodeForAddress[]
    callCodeAddresses?: Address[],
}
