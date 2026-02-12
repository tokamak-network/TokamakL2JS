import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeLeavesForAddress, PermutationForAddress, RegisteredKeysForAddress, TokamakL2StateManagerOpts } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { IMT, IMTHashFunction, IMTMerkleProof, IMTNode } from "@zk-kit/imt"
import { addHexPrefix, Address, bytesToBigInt, bytesToHex, concatBytes, createAccount, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { MAX_MT_LEAVES, MT_DEPTH, POSEIDON_INPUTS } from "../interface/params/index.js";
import { poseidon, poseidon_raw } from "../crypto/index.js";
import { batchBigIntTo32BytesEach } from "../utils/utils.js";
import { StateSnapshot } from "../interface/stateSnapshot/types.js";
import { treeNodeToBigint } from "./utils.js";



export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _cachedOpts: TokamakL2StateManagerOpts | null = null
    private _registeredKeys: RegisteredKeysForAddress[] | null = null
    private _initialMerkleTrees: TokamakL2MerkleTrees | null = null

    public async initTokamakExtendsFromRPC(rpcUrl: string, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromRPC(rpcUrl, opts);

        if (this._initialMerkleTrees !== null) {
            throw new Error('Merkle trees are already initialized')
        }
        this._initialMerkleTrees = await TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this);
    }

    public async initTokamakExtendsFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromSnapshot(snapshot, opts);

        if (this._initialMerkleTrees !== null) {
            throw new Error('Merkle tree is already initialized')
        }
        this._initialMerkleTrees = await TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this);
        if (this._initialMerkleTrees.merkleTrees.length !== snapshot.stateRoots.length) {
            throw new Error(`Inconsistent numbers of Merkle trees between state manager and state snapshot.`)
        }
        if (this._initialMerkleTrees.merkleTrees.every((tree, idx) => BigInt(tree.root) !== hexToBigInt(addHexPrefix(snapshot.stateRoots[idx])))) {
            throw new Error(`Creating TokamakL2StateManager using StateSnapshot fails: (provided roots: ${snapshot.stateRoots}, reconstructed root: ${this._initialMerkleTrees.merkleTrees.map(tree => tree.root.toString())})`)
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
        await this.flush();
    }

    async fetchStorageFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerOpts): Promise<void> {
        for (const codeInfo of opts.contractCodes) {
            await this.putCode(codeInfo.address, hexToBytes(codeInfo.code));
        }
        if (this._registeredKeys !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        if (snapshot.storageAddresses.length !== snapshot.registeredKeys.length) {
            throw new Error('Snapshot is expected to have a set of register keys for each storage address')
        }
        if (snapshot.storageAddresses.length !== snapshot.preAllocatedLeaves.length) {
            throw new Error('Snapshot is expected to have a set of pre-allocated leaves for each storage address')
        }
        if (snapshot.storageAddresses.length !== snapshot.storageEntries.length) {
            throw new Error('Snapshot is expected to have a set of storage entries for each storage address')
        }
        for (const [idx, addressStr] of snapshot.storageAddresses.entries()) {
            const address = createAddressFromString(addressStr);
            this._registeredKeys.push({
                address,
                keys: snapshot.registeredKeys[idx].map(str => hexToBytes(addHexPrefix(str))),
            });
            for (const entry of [...snapshot.storageEntries[idx], ...snapshot.preAllocatedLeaves[idx]]) {
                const vBytes = hexToBytes(addHexPrefix(entry.value));
                const keyBytes = hexToBytes(addHexPrefix(entry.key));
                await this.putStorage(address, keyBytes, vBytes);
            }
        }
        await this.flush();
    }

    public async convertLeavesIntoMerkleTreeLeavesForAddress(): Promise<MerkleTreeLeavesForAddress[]> {
        const leaves: MerkleTreeLeavesForAddress[] = [];
        for (const keysByAddress of this.cachedOpts.initStorageKeys){ 
            const leavesForAddress: bigint[] = [];
            const registeredKeysForAddress = this.registeredKeys.find(entry => entry.address.equals(keysByAddress.address)).keys;
            for (var index = 0; index < MAX_MT_LEAVES; index++) {
                const key = registeredKeysForAddress[index];
                let leafData: Uint8Array;
                if (key === undefined) {
                    leafData = batchBigIntTo32BytesEach(0n, 0n);
                } else {
                    const val = await this.getStorage(keysByAddress.address, key);
                    leafData = concatBytes(...[
                        key, 
                        val
                    ].map(raw => setLengthLeft(raw, 32)));
                }
                leavesForAddress[index] = bytesToBigInt(poseidon(leafData));
            }
            leaves.push({address: keysByAddress.address, leaves: leavesForAddress});
        }
        return leaves
    }

    private _permuteRegisteredKeys(permutations: PermutationForAddress[]) {
        if (this._registeredKeys === null) {
            throw new Error('Registered storage keys must be permuted after init.')
        }
        for (const [idx, registeredKeysForAddress] of this.registeredKeys.entries()) {
            const address = registeredKeysForAddress.address;
            const permutation = permutations.find(entry => entry.address.equals(address)).permutation;
            const permutedKeys: Uint8Array[] = registeredKeysForAddress.keys.map((arr) => new Uint8Array(arr));
            for (const [newIdx, oldIdx] of permutation.entries()) {
                permutedKeys[newIdx] = registeredKeysForAddress.keys[oldIdx].slice();
            }
            this._registeredKeys[idx] = {
                address,
                keys: permutedKeys
            };
        }
    }

    // getters
    public get initialMerkleTrees(): TokamakL2MerkleTrees {
        if (this._initialMerkleTrees === null) {
            throw new Error('Merkle trees are not initialized')
        }
        return this._initialMerkleTrees
    }

    public async getUpdatedMerkleTreeRoots(permutations?: PermutationForAddress[]): Promise<bigint[]> {
        if (permutations !== undefined) {
            this._permuteRegisteredKeys(permutations);
        }
        await this.flush();
        const merkleTrees = await TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this)
        return merkleTrees.merkleTrees.map(tree => treeNodeToBigint(tree.root))
    }

    public getMerkleProof(treeIndex: [number, number]): IMTMerkleProof {
        return this.initialMerkleTrees.merkleTrees[treeIndex[0]].createProof(treeIndex[1])
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
        if (prevSnapshot.storageAddresses.length !== prevSnapshot.preAllocatedLeaves.length) {
            throw new Error('Snapshot is expected to have a set of pre-allocated leaves for each storage address')
        }
        if (prevSnapshot.storageAddresses.length !== prevSnapshot.storageEntries.length) {
            throw new Error('Snapshot is expected to have a set of storage entries for each storage address')
        }
        await this.flush();
        const getUpdatedEntry = async (
            address: Address,
            entry: {key: string; value: string;}
        ): Promise<{key: string; value: string;}> => {
            const keyBytes = hexToBytes(addHexPrefix(entry.key));
            const value = await this.getStorage(address, keyBytes);
            return {
                key: entry.key,
                value: bytesToHex(value),
            }
        }

        const registeredKeysByAddress = new Map<string, Uint8Array[]>(
            this.registeredKeys.map((entry) => [entry.address.toString().toLowerCase(), entry.keys])
        );
        const merkleTrees = await TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this);
        const rootByAddress = new Map<string, string>();
        for (const [idx, address] of merkleTrees.addresses.entries()) {
            rootByAddress.set(
                address.toString().toLowerCase(),
                treeNodeToBigint(merkleTrees.merkleTrees[idx].root).toString(16)
            );
        }

        const registeredKeys: string[][] = [];
        const storageEntries: { key: string; value: string }[][] = [];
        const preAllocatedLeaves: { key: string; value: string }[][] = [];
        const stateRoots: string[] = [];

        for (const [idx, addressStr] of prevSnapshot.storageAddresses.entries()) {
            const address = createAddressFromString(addressStr);
            const addressKey = address.toString().toLowerCase();
            const currentRegisteredKeys = registeredKeysByAddress.get(addressKey);
            const currentRoot = rootByAddress.get(addressKey);

            if (currentRegisteredKeys === undefined || currentRoot === undefined) {
                throw new Error(`Cannot capture snapshot for unregistered storage address: ${addressStr}`)
            }

            registeredKeys.push(currentRegisteredKeys.map((key) => bytesToHex(key)));
            storageEntries.push(
                await Promise.all(prevSnapshot.storageEntries[idx].map((entry) => getUpdatedEntry(address, entry)))
            );
            preAllocatedLeaves.push(
                await Promise.all(prevSnapshot.preAllocatedLeaves[idx].map((entry) => getUpdatedEntry(address, entry)))
            );
            stateRoots.push(currentRoot);
        }

        return {
            channelId: prevSnapshot.channelId,
            stateRoots,
            storageAddresses: [...prevSnapshot.storageAddresses],
            registeredKeys,
            storageEntries,
            preAllocatedLeaves,
            entryContractAddress: prevSnapshot.entryContractAddress,
        };
    }
}

class TokamakL2MerkleTrees {
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
