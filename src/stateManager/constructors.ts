import { TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { TokamakL2StateManager } from "./TokamakL2StateManager.js";
import { MAX_MT_LEAVES } from "../interface/params/index.js";
import { StateSnapshot } from "../interface/channel/types.js";

export async function createTokamakL2StateManagerFromL1RPC(
    rpcUrl: string,
    opts: TokamakL2StateManagerRPCOpts,
): Promise<TokamakL2StateManager> {
    if (opts.storageAddresses.length !== opts.initStorageKeys.length) {
        throw new Error('Creating TokamakL2StateManager from RPC requires one initStorageKeys entry per storage address.')
    }
    for (const [idx, keyPairs] of opts.initStorageKeys.entries()) {
        if (keyPairs.length > MAX_MT_LEAVES) {
            throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${keyPairs.length} for address ${opts.storageAddresses[idx]}`)
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
    for (const [idx, storageEntriesForAddress] of snapshot.storageEntries.entries()) {
        if (storageEntriesForAddress.length > MAX_MT_LEAVES) {
            throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${storageEntriesForAddress.length} for address ${snapshot.storageAddresses[idx]}`)
        }
    }
    const stateManager = new TokamakL2StateManager();
    
    await stateManager.initTokamakExtendsFromSnapshot(snapshot, opts);
    return stateManager
}
