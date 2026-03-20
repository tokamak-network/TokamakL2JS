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

export type TokamakL2StateManagerCommonOpts = {
    common: Common,
}

export type TokamakL2StateManagerRPCOpts = TokamakL2StateManagerCommonOpts

export type TokamakL2StateManagerSnapshotOpts = TokamakL2StateManagerCommonOpts & {
    contractCodes?: contractCodeForAddress[]
}
