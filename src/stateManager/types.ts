import { Address } from "@ethereumjs/util";

export type MerkleTreeMembers = Map<bigint, Map<bigint, bigint>>;   // Map<address, Map<storageKey, value>>

export type contractCodeForAddress = {
    address: Address,
    code: `0x${string}`,
};

export type TokamakL2StateManagerRPCOpts = {
    blockNumber: number,
    callCodeAddresses: Address[],
    // Multiple initStorageKeys for multiple addresses
    storageConfig: {
        address: Address,
        keyPairs: {
            L1: Uint8Array,
            L2: Uint8Array,
        }[],
    }[],
}

export type TokamakL2StateManagerSnapshotOpts = {
    contractCodes: contractCodeForAddress[]
}
