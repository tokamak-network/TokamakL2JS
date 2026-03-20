import { TokamakL2StateManagerOpts } from "./types.js";
import { TokamakL2StateManager } from "./TokamakL2StateManager.js";
import { MAX_MT_LEAVES } from "../interface/params/index.js";
import { StateSnapshot } from "../interface/channel/types.js";

export async function createTokamakL2StateManagerFromL1RPC(
    rpcUrl: string,
    opts: TokamakL2StateManagerOpts,
): Promise<TokamakL2StateManager> {
    if (opts.initStorageKeys === undefined) {
        throw new Error('Creating TokamakL2StateManager using StateSnapshot requires L1 and L2 key pairs.')
    }
    if (opts.initStorageKeys.length > MAX_MT_LEAVES) {
        throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${opts.initStorageKeys.length}`)
    }

    const stateManager = new TokamakL2StateManager(opts);
    
    await stateManager.initTokamakExtendsFromRPC(rpcUrl, opts);
    return stateManager
}

export async function createTokamakL2StateManagerFromStateSnapshot(
    snapshot: StateSnapshot,
    opts: TokamakL2StateManagerOpts,
): Promise<TokamakL2StateManager> {
    if (snapshot.storageAddresses.length !== snapshot.storageEntries.length) {
        throw new Error('Snapshot is expected to have a set of storage entries for each storage address')
    }
    for (const [idx, storageEntriesForAddress] of snapshot.storageEntries.entries()) {
        if (storageEntriesForAddress.length > MAX_MT_LEAVES) {
            throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${storageEntriesForAddress.length} for address ${snapshot.storageAddresses[idx]}`)
        }
    }
    const stateManager = new TokamakL2StateManager(opts);
    
    await stateManager.initTokamakExtendsFromSnapshot(snapshot, opts);
    return stateManager
}
