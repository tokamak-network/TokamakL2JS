import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeLeavesForAddress, RegisteredKeysForAddress, TokamakL2StateManagerOpts, TrackedStorageKeysForAddress } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { IMT, IMTHashFunction, IMTMerkleProof, IMTNode } from "@zk-kit/imt"
import { addHexPrefix, Address, bytesToBigInt, bytesToHex, concatBytes, createAccount, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { MAX_MT_LEAVES, MT_DEPTH, NULL_STORAGE_KEY, POSEIDON_INPUTS } from "../interface/params/index.js";
import { poseidon, poseidon_raw } from "../crypto/index.js";
import { batchBigIntTo32BytesEach } from "../utils/index.js";
import { StateSnapshot } from "../interface/stateSnapshot/types.js";
import { treeNodeToBigint } from "./utils.js";

export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _cachedOpts: TokamakL2StateManagerOpts | null = null
    private _registeredKeys: RegisteredKeysForAddress[] | null = null
    private _trackedStorageKeys: Map<bigint, TrackedStorageKeysForAddress> = new Map()

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
        const keyHex = addHexPrefix(bytesToHex(key)) as `0x${string}`
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
            }

            const knownKeys = new Set<bigint>(
                registeredKeysForAddress.keys.map((entry) => bytesToBigInt(entry))
            )
            for (const [keyBigInt, keyHex] of trackedKeysForAddress.keys.entries()) {
                if (knownKeys.has(keyBigInt)) {
                    continue
                }
                registeredKeysForAddress.keys.push(hexToBytes(addHexPrefix(keyHex)))
                knownKeys.add(keyBigInt)
            }
        }
    }

    public async initTokamakExtendsFromRPC(rpcUrl: string, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromRPC(rpcUrl, opts);
    }

    public async initTokamakExtendsFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromSnapshot(snapshot, opts);

        const merkleTrees = await this.getUpdatedMerkleTree();
        if (merkleTrees.merkleTrees.length !== snapshot.stateRoots.length) {
            throw new Error(`Inconsistent numbers of Merkle trees between state manager and state snapshot.`)
        }
        if (merkleTrees.merkleTrees.some((tree, idx) => treeNodeToBigint(tree.root) !== hexToBigInt(addHexPrefix(snapshot.stateRoots[idx])))) {
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
        const blockTag = opts.blockNumber
        const normalizeRpcError = (error: unknown): Error => {
            if (blockTag !== undefined && error instanceof Error && error.message.includes('block not found')) {
                return new Error(
                    `RPC endpoint does not provide historical state for block ${blockTag}. Use an archive-capable RPC or omit blockNumber to read the latest state.`
                )
            }
            return error instanceof Error ? error : new Error(String(error))
        }
        for (const addr of opts.callCodeAddresses) {
            let byteCodeStr: string
            try {
                byteCodeStr = await provider.getCode(addr.toString(), blockTag)
            } catch (error) {
                throw normalizeRpcError(error)
            }
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

                let v: string
                try {
                    v = await provider.getStorage(keysByAddress.address.toString(), bytesToBigInt(keys.L1), blockTag);
                } catch (error) {
                    throw normalizeRpcError(error)
                }
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
        await this.flush();
    }

    async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
        await super.putStorage(address, key, value)
        this.trackStorageKey(address, key)
    }

    public async convertLeavesIntoMerkleTreeLeavesForAddress(): Promise<MerkleTreeLeavesForAddress[]> {
        const leaves: MerkleTreeLeavesForAddress[] = [];
        for (const registeredKeysForAddress of this.registeredKeys){ 
            const address = registeredKeysForAddress.address;
            const leavesForAddress: bigint[] = [];
            for (var index = 0; index < MAX_MT_LEAVES; index++) {
                const key = registeredKeysForAddress.keys[index];
                let leafData: Uint8Array;
                if (key === undefined) {
                    leafData = batchBigIntTo32BytesEach(NULL_STORAGE_KEY, 0n);
                } else {
                    const val = await this.getStorage(address, key);
                    leafData = concatBytes(...[
                        key, 
                        val
                    ].map(raw => setLengthLeft(raw, 32)));
                }
                leavesForAddress[index] = bytesToBigInt(poseidon(leafData));
            }
            leaves.push({address, leaves: leavesForAddress});
        }
        return leaves
    }

    public async getUpdatedMerkleTree(): Promise<TokamakL2MerkleTrees> {
        await this.flush();
        this.syncRegisteredKeysFromTrackedStorage();
        return TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this)
    }

    public get registeredKeys() {return this._registeredKeys}
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
        const entryContractAddress = this.cachedOpts!.entryContractAddress;
        if (hexToBigInt(addHexPrefix(prevSnapshot.entryContractAddress)) !==  bytesToBigInt(entryContractAddress.bytes)) {
            throw new Error ('Mismatch between contract addresses of the previous state snapshot and the current state.')
        }
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

        const merkleTrees = await this.getUpdatedMerkleTree();
        const registeredKeysByAddress = new Map<string, Uint8Array[]>(
            this.registeredKeys.map((entry) => [entry.address.toString().toLowerCase(), entry.keys])
        );
        const rootByAddress = new Map<string, string>();
        for (const [idx, address] of merkleTrees.addresses.entries()) {
            rootByAddress.set(
                address.toString().toLowerCase(),
                treeNodeToBigint(merkleTrees.merkleTrees[idx].root).toString(16)
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
            entryContractAddress: prevSnapshot.entryContractAddress,
        };
    }
}

export class TokamakL2MerkleTrees {
    private _cachedTokamakL2StateManager: TokamakL2StateManager | null = null;
    private _addresses: Address[] = [];
    private _merkleTrees: IMT[] = [];

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

    public addMerkleTree(address: Address, mt: IMT) {
        this._addresses.push(address);
        this._merkleTrees.push(mt);
    }

    public getRoots(): bigint[] {
        return this.merkleTrees.map((tree) => treeNodeToBigint(tree.root));
    }

    public getProof(treeIndex: [number, number]): IMTMerkleProof {
        return this.merkleTrees[treeIndex[0]].createProof(treeIndex[1]);
    }

    public static async buildFromTokamakL2StateManager(mpt: TokamakL2StateManager): Promise<TokamakL2MerkleTrees> {
        const tokamakL2MerkleTree = new TokamakL2MerkleTrees(mpt);
        const treeDepth = MT_DEPTH
        const leaves = await mpt.convertLeavesIntoMerkleTreeLeavesForAddress()
        for (const leavesForAddress of leaves) {
            const mt = new IMT(poseidon_raw as IMTHashFunction, treeDepth, 0n, POSEIDON_INPUTS, leavesForAddress.leaves as IMTNode[]);
            tokamakL2MerkleTree.addMerkleTree(leavesForAddress.address, mt);
        }
        return tokamakL2MerkleTree
    }
}
