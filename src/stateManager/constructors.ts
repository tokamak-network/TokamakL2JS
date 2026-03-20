import { TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { TokamakL2StateManager } from "./TokamakL2StateManager.js";
import { MAX_MT_LEAVES } from "../interface/params/index.js";
import { StateSnapshot } from "../interface/channel/types.js";
import { ChannelStateConfig } from "../interface/configuration/types.js";

export async function createTokamakL2StateManagerFromL1RPC(
    rpcUrl: string,
    config: ChannelStateConfig,
    opts: TokamakL2StateManagerRPCOpts,
): Promise<TokamakL2StateManager> {
    for (const storageConfig of config.storageConfigs) {
        const totalStorageEntries = storageConfig.preAllocatedKeys.length + (storageConfig.userStorageSlots.length * config.participants.length);
        if (totalStorageEntries > MAX_MT_LEAVES) {
            throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${totalStorageEntries} for address ${storageConfig.address}`)
        }
    }

    const stateManager = new TokamakL2StateManager(opts);
    
    await stateManager.initTokamakExtendsFromRPC(rpcUrl, config, opts);
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
    const stateManager = new TokamakL2StateManager(opts);
    
    await stateManager.initTokamakExtendsFromSnapshot(snapshot, opts);
    return stateManager
}
