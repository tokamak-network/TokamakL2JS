import { TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { TokamakL2StateManager } from "./TokamakL2StateManager.js";
import { StateSnapshot } from "../interface/channel/types.js";
import { createTokamakL2Common } from "../common/index.js";

export async function createTokamakL2StateManagerFromL1RPC(
    rpcUrl: string,
    opts: TokamakL2StateManagerRPCOpts,
): Promise<TokamakL2StateManager> {
    if (opts.callCodeAddresses.length === 0) {
        throw new Error('Creating TokamakL2StateManager from RPC requires at least one call code address')
    }
    const stateManager = new TokamakL2StateManager({common: createTokamakL2Common()});
    
    await stateManager.initTokamakExtendsFromRPC(rpcUrl, opts);
    return stateManager
}

export async function createTokamakL2StateManagerFromStateSnapshot(
    snapshot: StateSnapshot,
    opts: TokamakL2StateManagerSnapshotOpts,
): Promise<TokamakL2StateManager> {
    if (opts.contractCodes.length === 0) {
        throw new Error('Creating TokamakL2StateManager from a StateSnapshot requires at least one call code address')
    }
    const stateManager = new TokamakL2StateManager({common: createTokamakL2Common()});
    
    await stateManager.initTokamakExtendsFromSnapshot(snapshot, opts);
    return stateManager
}
