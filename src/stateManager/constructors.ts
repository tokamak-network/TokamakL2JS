import { TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { TokamakL2StateManager } from "./TokamakL2StateManager.js";
import { MAX_MT_LEAVES } from "../interface/params/index.js";
import { StateSnapshot } from "../interface/channel/types.js";

export async function createTokamakL2StateManagerFromL1RPC(
    rpcUrl: string,
    opts: TokamakL2StateManagerRPCOpts,
): Promise<TokamakL2StateManager> {
    if (opts.callCodeAddresses.length === 0) {
        throw new Error('Creating TokamakL2StateManager from RPC requires at least one call code address')
    }
    for (const storageConfig of opts.storageConfig) {
        if (storageConfig.keyPairs.length > MAX_MT_LEAVES) {
            throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${storageConfig.keyPairs.length} for address ${storageConfig.address}`)
        }
    }
    const stateManager = new TokamakL2StateManager();
    
    await stateManager.initTokamakExtendsFromRPC(rpcUrl, opts);
    return stateManager
}

export async function createTokamakL2StateManagerFromStateSnapshot(
    snapshot: StateSnapshot,
    opts: TokamakL2StateManagerSnapshotOpts,
): Promise<TokamakL2StateManager> {
    if (snapshot.storageAddresses.length !== snapshot.storageEntries.length) {
        throw new Error('Snapshot is expected to have a set of storage entries for each storage address')
    }
    if (opts.contractCodes.length === 0) {
        throw new Error('Creating TokamakL2StateManager from a StateSnapshot requires at least one call code address')
    }
    for (const [idx, storageEntriesForAddress] of snapshot.storageEntries.entries()) {
        if (storageEntriesForAddress.length > MAX_MT_LEAVES) {
            throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${storageEntriesForAddress.length} for address ${snapshot.storageAddresses[idx]}`)
        }
    }
    const stateManager = new TokamakL2StateManager();
    
    await stateManager.initTokamakExtendsFromSnapshot(snapshot, opts);
    return stateManager
}
