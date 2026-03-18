import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeMembers, RegisteredKeysForAddress, TokamakL2StateManagerOpts, TrackedStorageKeysForAddress } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { SMT, type MerkleProof } from "@zk-kit/smt"
import { addHexPrefix, Address, bytesToBigInt, bytesToHex, createAccount, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { poseidonChainCompress } from "../crypto/index.js";
import { StateSnapshot } from "../interface/channel/types.js";

export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _cachedOpts: TokamakL2StateManagerOpts | null = null
    private _registeredKeys: RegisteredKeysForAddress[] | null = null
    private _registeredKeyIndexByAddress: Map<bigint, Set<bigint>> = new Map()
    private _trackedStorageKeys: Map<bigint, TrackedStorageKeysForAddress> = new Map()
    private _lastMerkleTrees: TokamakL2MerkleTrees | null = null

    private rebuildRegisteredKeyIndex(): void {
        if (this._registeredKeys === null) {
            throw new Error('Registered storage keys are not initialized.')
        }

        this._registeredKeyIndexByAddress = new Map(
            this._registeredKeys.map((entry) => [
                bytesToBigInt(entry.address.bytes),
                new Set(entry.keys.map((key) => bytesToBigInt(key))),
            ])
        )
    }

    private trackStorageKey(address: Address, key: Uint8Array): void {
        const addressBigInt = bytesToBigInt(address.bytes)
        let trackedKeysForAddress = this._trackedStorageKeys.get(addressBigInt)
        if (trackedKeysForAddress === undefined) {
            trackedKeysForAddress = {
                address,
                keys: new Map(),
            }
            this._trackedStorageKeys.set(addressBigInt, trackedKeysForAddress)
        }
        const keyHex = addHexPrefix(bytesToHex(key))
        const keyBigInt = hexToBigInt(keyHex)
        if (!trackedKeysForAddress.keys.has(keyBigInt)) {
            trackedKeysForAddress.keys.set(keyBigInt, keyHex)
        }
    }

    private syncRegisteredKeysFromTrackedStorage(): void {
        if (this._registeredKeys === null) {
            throw new Error('Registered storage keys are not initialized.')
        }

        const registeredByAddress = new Map<bigint, RegisteredKeysForAddress>(
            this._registeredKeys.map((entry) => [bytesToBigInt(entry.address.bytes), entry])
        )

        for (const [addressBigInt, trackedKeysForAddress] of this._trackedStorageKeys.entries()) {
            let registeredKeysForAddress = registeredByAddress.get(addressBigInt)
            if (registeredKeysForAddress === undefined) {
                registeredKeysForAddress = {
                    address: trackedKeysForAddress.address,
                    keys: [],
                }
                this._registeredKeys.push(registeredKeysForAddress)
                registeredByAddress.set(addressBigInt, registeredKeysForAddress)
                this._registeredKeyIndexByAddress.set(addressBigInt, new Set())
            }

            const knownKeys = this._registeredKeyIndexByAddress.get(addressBigInt)
            if (knownKeys === undefined) {
                throw new Error('Registered storage key index is not initialized.')
            }
            for (const [keyBigInt, keyHex] of trackedKeysForAddress.keys.entries()) {
                if (knownKeys.has(keyBigInt)) {
                    continue
                }
                registeredKeysForAddress.keys.push(hexToBytes(keyHex))
                knownKeys.add(keyBigInt)
            }
        }

        this._trackedStorageKeys.clear()
    }

    public async initTokamakExtendsFromRPC(rpcUrl: string, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromRPC(rpcUrl, opts);
        await this._getUpdatedMerkleTree();
    }

    public async initTokamakExtendsFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromSnapshot(snapshot, opts);

        const merkleTrees = await this._getUpdatedMerkleTree();
        if (merkleTrees.merkleTrees.length !== snapshot.stateRoots.length) {
            throw new Error(`Inconsistent numbers of Merkle trees between state manager and state snapshot.`)
        }
        if (merkleTrees.merkleTrees.some((tree, idx) => (tree.root as bigint) !== hexToBigInt(addHexPrefix(snapshot.stateRoots[idx])))) {
            throw new Error(`Creating TokamakL2StateManager using StateSnapshot fails: (provided roots: ${snapshot.stateRoots}, reconstructed root: ${merkleTrees.merkleTrees.map(tree => tree.root.toString())})`)
        }
    }

    async initTokamakExtend(opts: TokamakL2StateManagerOpts): Promise<void> {
        if (opts.common.customCrypto.keccak256 === undefined) {
            throw new Error('Custom crypto must be set')
        }
        const openAccount = async (address: Address) => {
            const POSEIDON_RLP = opts.common.customCrypto.keccak256(RLP.encode(new Uint8Array([])));
            const POSEIDON_NULL = opts.common.customCrypto.keccak256(new Uint8Array(0));
            const contractAccount = createAccount({nonce: 0n, balance: 0n, storageRoot: POSEIDON_RLP, codeHash: POSEIDON_NULL});
            await this.putAccount(address, contractAccount);
        }
        if (opts.storageAddresses === undefined && opts.initStorageKeys === undefined) {
            throw new Error('Initializing TokamakL2StateManager requires storage addresses')
        }
        const addresses: Address[] = opts.storageAddresses ?? opts.initStorageKeys.map(entry => entry.address);
        await Promise.all(addresses.map(addr => openAccount(addr)));
    }

    async fetchStorageFromRPC(rpcUrl: string, opts: TokamakL2StateManagerOpts): Promise<void> {
        const provider = new ethers.JsonRpcProvider(rpcUrl)
        if (opts.blockNumber === undefined ) {
            throw new Error('Creating TokamakL2StateManager from RPC requires a block number.')
        }
        for (const addr of opts.callCodeAddresses) {
            const byteCodeStr = await provider.getCode(addr.toString(), opts.blockNumber)
            await this.putCode(addr, hexToBytes(addHexPrefix(byteCodeStr)))
        }
        if (opts.initStorageKeys === undefined) {
            throw new Error('Creating TokamakL2StateManager from RPC requires L1 and L2 key pairs.')
        }
        if (this._registeredKeys !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        this._registeredKeys = [];
        for (const keysByAddress of opts.initStorageKeys) {
            if (await this.getAccount(keysByAddress.address) === undefined) {
                throw new Error('TokamakL2StateManager is not initialized.')
            }
            const usedL1Keys = new Set<bigint>();
            const registeredL2KeyBigInts = new Set<bigint>();
            const registeredL2Keys: Uint8Array[] = [];
            for (const keys of keysByAddress.keyPairs) {
                const keyL1BigInt = bytesToBigInt(keys.L1);
                const keyL2BigInt = bytesToBigInt(keys.L2);
                if (usedL1Keys.has(keyL1BigInt)) {
                    throw new Error(`Duplication in L1 MPT keys.`);
                }
                if (registeredL2KeyBigInts.has(keyL2BigInt)) {
                    throw new Error(`Duplication in L2 MPT keys.`);
                }

                const v = await provider.getStorage(keysByAddress.address.toString(), bytesToBigInt(keys.L1), opts.blockNumber);
                const vBytes = hexToBytes(addHexPrefix(v));
                await this.putStorage(keysByAddress.address, keys.L2, vBytes);

                usedL1Keys.add(keyL1BigInt);
                registeredL2KeyBigInts.add(keyL2BigInt);
                registeredL2Keys.push(keys.L2);
            }
            this._registeredKeys.push({
                address: keysByAddress.address,
                keys: registeredL2Keys,
            });
        }
        this.rebuildRegisteredKeyIndex();
        this._trackedStorageKeys.clear();
        await this.flush();
    }

    async fetchStorageFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerOpts): Promise<void> {
        for (const codeInfo of opts.contractCodes ?? []) {
            await this.putCode(codeInfo.address, hexToBytes(codeInfo.code));
        }
        if (this._registeredKeys !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        if (snapshot.storageAddresses.length !== snapshot.registeredKeys.length) {
            throw new Error('Snapshot is expected to have a set of register keys for each storage address')
        }
        this._registeredKeys = [];
        for (const [idx, addressStr] of snapshot.storageAddresses.entries()) {
            const address = createAddressFromString(addressStr);
            const registeredKeysForAddress = snapshot.registeredKeys[idx].map((entry) => hexToBytes(addHexPrefix(entry.key)));
            for (const entry of snapshot.registeredKeys[idx]) {
                const vBytes = hexToBytes(addHexPrefix(entry.value));
                const keyBytes = hexToBytes(addHexPrefix(entry.key));
                await this.putStorage(address, keyBytes, vBytes);
            }
            this._registeredKeys.push({
                address,
                keys: registeredKeysForAddress,
            });
        }
        this.rebuildRegisteredKeyIndex();
        this._trackedStorageKeys.clear();
        await this.flush();
    }

    async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
        await super.putStorage(address, key, value)
        this.trackStorageKey(address, key)
        if (this._lastMerkleTrees !== null) {
            await this._getUpdatedMerkleTree()
        }
    }

    public async convertLeavesIntoMerkleTreeLeavesForAddress(): Promise<MerkleTreeMembers> {
        const leaves: MerkleTreeMembers = new Map();
        for (const registeredKeysForAddress of this.registeredKeys){ 
            const address = registeredKeysForAddress.address;
            const leavesForAddress = new Map<bigint, bigint>();
            for (const key of registeredKeysForAddress.keys) {
                const val = await this.getStorage(address, key);
                leavesForAddress.set(bytesToBigInt(key), bytesToBigInt(val));
            }
            leaves.set(bytesToBigInt(address.bytes), leavesForAddress);
        }
        return leaves
    }

    private async _getUpdatedMerkleTree(): Promise<TokamakL2MerkleTrees> {
        await this.flush();
        this.syncRegisteredKeysFromTrackedStorage();
        this._lastMerkleTrees = await TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this)
        return this._lastMerkleTrees
    }

    public get registeredKeys() {return this._registeredKeys}
    public get lastMerkleTrees(): TokamakL2MerkleTrees {
        if (this._lastMerkleTrees === null) {
            throw new Error('Merkle trees are not initialized.')
        }
        return this._lastMerkleTrees
    }
    public getMerkleTreeLeafIndex(address: Address, key: bigint): [number, number] {
        const addressIndex = this.registeredKeys.findIndex(entry => entry.address.equals(address));
        if (addressIndex === -1) {
            return [-1, -1];
        }
        const registeredKeysForAddress = this.registeredKeys[addressIndex].keys;
        const leafIndex = registeredKeysForAddress.findIndex(
            register => bytesToBigInt(register) === key
          )
        return [addressIndex, leafIndex]
    }
    public get cachedOpts() {return this._cachedOpts}

    public async captureStateSnapshot(prevSnapshot: StateSnapshot): Promise<StateSnapshot> {
        if (this.registeredKeys === null) {
            throw new Error('Registered storage keys are not initialized.')
        }
        if (prevSnapshot.storageAddresses.length !== prevSnapshot.registeredKeys.length) {
            throw new Error('Snapshot is expected to have a set of register keys for each storage address')
        }
        await this.flush();
        const getUpdatedEntry = async (address: Address, keyBytes: Uint8Array): Promise<{key: string; value: string;}> => {
            const value = await this.getStorage(address, keyBytes);
            return {
                key: bytesToHex(keyBytes),
                value: bytesToHex(value),
            }
        }

        const merkleTrees = this.lastMerkleTrees;
        const registeredKeysByAddress = new Map<string, Uint8Array[]>(
            this.registeredKeys.map((entry) => [entry.address.toString().toLowerCase(), entry.keys])
        );
        const rootByAddress = new Map<string, string>();
        for (const [idx, address] of merkleTrees.addresses.entries()) {
            rootByAddress.set(
                address.toString().toLowerCase(),
                (merkleTrees.merkleTrees[idx].root as bigint).toString(16)
            );
        }

        const registeredKeys: { key: string; value: string }[][] = [];
        const stateRoots: string[] = [];

        for (const addressStr of prevSnapshot.storageAddresses) {
            const address = createAddressFromString(addressStr);
            const addressKey = address.toString().toLowerCase();
            const currentRegisteredKeys = registeredKeysByAddress.get(addressKey);
            const currentRoot = rootByAddress.get(addressKey);

            if (currentRegisteredKeys === undefined || currentRoot === undefined) {
                throw new Error(`Cannot capture snapshot for unregistered storage address: ${addressStr}`)
            }

            registeredKeys.push(
                await Promise.all(currentRegisteredKeys.map((key) => getUpdatedEntry(address, key)))
            );
            stateRoots.push(currentRoot);
        }

        return {
            channelId: prevSnapshot.channelId,
            stateRoots,
            storageAddresses: [...prevSnapshot.storageAddresses],
            registeredKeys,
        };
    }
}

export class TokamakL2MerkleTrees {
    private _cachedTokamakL2StateManager: TokamakL2StateManager | null = null;
    private _addresses: Address[] = [];
    private _merkleTrees: SMT[] = [];

    constructor(stateManager: TokamakL2StateManager) {
        this._cachedTokamakL2StateManager = stateManager;
    }

    public get cachedTokamakL2StateManager() {
        return this._cachedTokamakL2StateManager
    }

    public get addresses() {
        return this._addresses
    }

    public get merkleTrees() {
        return this._merkleTrees
    }

    public addMerkleTree(address: Address, mt: SMT) {
        this._addresses.push(address);
        this._merkleTrees.push(mt);
    }

    public getRoots(): bigint[] {
        return this.merkleTrees.map((tree) => tree.root as bigint);
    }

    public getProof(treeIndex: [number, number]): MerkleProof {
        const key = this._cachedTokamakL2StateManager?.registeredKeys?.[treeIndex[0]]?.keys?.[treeIndex[1]];
        if (key === undefined) {
            throw new Error(`Merkle tree proof target is not registered: [${treeIndex[0]}, ${treeIndex[1]}]`);
        }
        return this.merkleTrees[treeIndex[0]].createProof(bytesToBigInt(key)) as MerkleProof;
    }

    public static async buildFromTokamakL2StateManager(mpt: TokamakL2StateManager): Promise<TokamakL2MerkleTrees> {
        const tokamakL2MerkleTree = new TokamakL2MerkleTrees(mpt);
        const leaves = await mpt.convertLeavesIntoMerkleTreeLeavesForAddress()
        for (const [addressBigInt, members] of leaves.entries()) {
            const mt = new SMT(poseidonChainCompress, true);
            for (const [key, value] of members.entries()) {
                mt.add(key, value);
            }
            tokamakL2MerkleTree.addMerkleTree(createAddressFromString(addHexPrefix(addressBigInt.toString(16).padStart(40, "0"))), mt);
        }
        return tokamakL2MerkleTree
    }
}
