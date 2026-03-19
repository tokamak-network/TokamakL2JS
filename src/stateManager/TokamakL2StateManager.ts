import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeMembers, TokamakL2StateManagerOpts } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { IMT, IMTHashFunction, IMTMerkleProof, IMTNode } from "@zk-kit/imt"
import { addHexPrefix, Address, bytesToBigInt, bytesToHex, concatBytes, createAccount, createAddressFromBigInt, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { MAX_MT_LEAVES, MT_DEPTH, NULL_LEAF, POSEIDON_INPUTS } from "../interface/params/index.js";
import { poseidon, poseidon_raw } from "../crypto/index.js";
import { RegisteredKeysJson, StateSnapshot } from "../interface/channel/types.js";
import { treeNodeToBigint } from "./utils.js";

export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _cachedOpts: TokamakL2StateManagerOpts | null = null
    private _storageEntries: MerkleTreeMembers | null = null
    private _merkleTrees: TokamakL2MerkleTrees | null = null

    public async initTokamakExtendsFromRPC(rpcUrl: string, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromRPC(rpcUrl, opts);
        await this._buildInitMerkleTrees();
    }

    public async initTokamakExtendsFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerOpts): Promise<void> {
        if (this._cachedOpts !== null) {
            throw new Error('Cannot rewrite cached opts')
        }
        this._cachedOpts = opts;

        await this.initTokamakExtend(opts);
        await this.fetchStorageFromSnapshot(snapshot, opts);

        const merkleTrees = await this._buildInitMerkleTrees();
        if (merkleTrees.trees.size !== snapshot.stateRoots.length) {
            throw new Error(`Inconsistent numbers of Merkle trees between state manager and state snapshot.`)
        }
        const addresses = merkleTrees.getAddresses();
        const roots = merkleTrees.getRoots();
        const rootByAddress = new Map<string, bigint>(
            addresses.map((address, idx) => [address.toString().toLowerCase(), roots[idx]])
        );
        const reconstructedRoots: string[] = [];

        for (const [idx, addressString] of snapshot.storageAddresses.entries()) {
            const reconstructedRoot = rootByAddress.get(addressString.toLowerCase());
            if (reconstructedRoot === undefined) {
                throw new Error(`Merkle tree is not registered for the address ${addressString}`)
            }
            reconstructedRoots.push(addHexPrefix(reconstructedRoot.toString(16)));
            if (reconstructedRoot !== hexToBigInt(addHexPrefix(snapshot.stateRoots[idx]))) {
                throw new Error(`Creating TokamakL2StateManager using StateSnapshot fails: (provided roots: ${snapshot.stateRoots}, reconstructed roots: ${reconstructedRoots})`)
            }
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
        if (this._storageEntries !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        this._storageEntries = new Map();
        for (const keysByAddress of opts.initStorageKeys) {
            if (await this.getAccount(keysByAddress.address) === undefined) {
                throw new Error('TokamakL2StateManager is not initialized.')
            }
            const usedL1Keys = new Set<bigint>();
            const registeredL2KeyBigInts = new Set<bigint>();
            this._storageEntries.set(bytesToBigInt(keysByAddress.address.bytes), new Map());
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
            }
        }
        await this.flush();
    }

    async fetchStorageFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerOpts): Promise<void> {
        for (const codeInfo of opts.contractCodes ?? []) {
            await this.putCode(codeInfo.address, hexToBytes(codeInfo.code));
        }
        if (this._storageEntries !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        if (snapshot.stateRoots.length !== snapshot.storageAddresses.length || snapshot.storageAddresses.length !== snapshot.registeredKeys.length) {
            throw new Error('Snapshot is expected to have a set of registered members for each state root')
        }
        this._storageEntries = new Map();
        for (const [idx, addressString] of snapshot.storageAddresses.entries()) {
            const address = createAddressFromString(addressString);
            this._storageEntries.set(bytesToBigInt(address.bytes), new Map());
            for (const entry of snapshot.registeredKeys[idx]) {
                const vBytes = hexToBytes(addHexPrefix(entry.value));
                const keyBytes = hexToBytes(addHexPrefix(entry.key));
                await this.putStorage(address, keyBytes, vBytes);
            }
        }
        await this.flush();
    }

    async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
        if (this._merkleTrees === null) {
            throw new Error('Merkle trees are not initialized')
        }
        if (this._storageEntries === null) {
            throw new Error('Storage entries are not fetched')
        }
        const addressBigInt = bytesToBigInt(address.bytes);
        const keyBigInt = bytesToBigInt(key);
        const valueBigInt = bytesToBigInt(value);

        await super.putStorage(address, key, value);
        await this.flush();
        const leaf = this._merkleTrees.update(addressBigInt, keyBigInt, valueBigInt);

        let storageEntriesForAddress = this._storageEntries.get(addressBigInt)
        if (leaf === null) {
            if (storageEntriesForAddress !== undefined && storageEntriesForAddress.has(keyBigInt)) {
                storageEntriesForAddress.delete(keyBigInt)
            }
        } else {
            if (storageEntriesForAddress === undefined) {
                storageEntriesForAddress = new Map()
                this._storageEntries.set(addressBigInt, storageEntriesForAddress)
            }
            storageEntriesForAddress.set(keyBigInt, valueBigInt)
        }
    }

    public async convertLeavesIntoMerkleTreeLeavesForAddress(): Promise<MerkleTreeMembers> {
        const leaves: MerkleTreeMembers = new Map();
        for (const [addressBigInt, storageEntriesForAddress] of this.storageEntries.entries()){ 
            const address = createAddressFromString(addHexPrefix(addressBigInt.toString(16).padStart(40, "0")));
            const leavesForAddress = new Map<bigint, bigint>();
            for (const key of storageEntriesForAddress.keys()) {
                const keyBytes = hexToBytes(addHexPrefix(key.toString(16).padStart(64, "0")));
                const val = await this.getStorage(address, keyBytes);
                leavesForAddress.set(key, bytesToBigInt(val));
            }
            leaves.set(addressBigInt, leavesForAddress);
        }
        return leaves
    }

    private async _buildInitMerkleTrees(): Promise<TokamakL2MerkleTrees> {
        await this.flush();
        this._merkleTrees = await TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this)
        return this._merkleTrees
    }

    public get storageEntries() {return this._storageEntries}
    public get merkleTrees(): TokamakL2MerkleTrees {
        if (this._merkleTrees === null) {
            throw new Error('Merkle trees are not initialized.')
        }
        return this._merkleTrees
    }
    public get cachedOpts() {return this._cachedOpts}

    public async captureStateSnapshot(prevSnapshot: StateSnapshot): Promise<StateSnapshot> {
        if (this.storageEntries === null) {
            throw new Error('Registered storage keys are not initialized.')
        }
        if (prevSnapshot.stateRoots.length !== prevSnapshot.storageAddresses.length || prevSnapshot.storageAddresses.length !== prevSnapshot.registeredKeys.length) {
            throw new Error('Snapshot is expected to have a set of registered members for each state root')
        }
        await this.flush();
        const getUpdatedEntry = async (address: Address, keyBytes: Uint8Array): Promise<{key: string; value: string;}> => {
            const value = await this.getStorage(address, keyBytes);
            return {
                key: bytesToHex(keyBytes),
                value: bytesToHex(value),
            }
        }

        const merkleTrees = this.merkleTrees;
        const registeredKeysByAddress = new Map<string, bigint[]>(
            Array.from(this.storageEntries.entries()).map(([addressBigInt, members]) => [
                createAddressFromString(addHexPrefix(addressBigInt.toString(16).padStart(40, "0"))).toString().toLowerCase(),
                Array.from(members.keys()),
            ])
        );
        const addresses = merkleTrees.getAddresses();
        const roots = merkleTrees.getRoots();
        const rootByAddress = new Map<string, string>(
            addresses.map((address, idx) => [
                address.toString().toLowerCase(),
                addHexPrefix(roots[idx].toString(16)),
            ])
        );

        const registeredKeys: RegisteredKeysJson = [];
        const stateRoots: string[] = [];

        for (const addressString of prevSnapshot.storageAddresses) {
            const address = createAddressFromString(addressString);
            const addressKey = address.toString().toLowerCase();
            const currentRegisteredKeys = registeredKeysByAddress.get(addressKey);
            const currentRoot = rootByAddress.get(addressKey);

            if (currentRegisteredKeys === undefined || currentRoot === undefined) {
                throw new Error(`Cannot capture snapshot for unregistered storage address: ${addressString}`)
            }

            registeredKeys.push(
                await Promise.all(
                    currentRegisteredKeys.map((key) => getUpdatedEntry(address, hexToBytes(addHexPrefix(key.toString(16).padStart(64, "0")))))
                )
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
    private _trees: Map<bigint, IMT> = new Map(); // Map<address, tree>

    constructor(stateManager: TokamakL2StateManager) {
        this._cachedTokamakL2StateManager = stateManager;
    }

    public get cachedTokamakL2StateManager() {
        return this._cachedTokamakL2StateManager
    }

    public get trees() {
        return this._trees
    }
    
    public update(address: bigint, key: bigint, value: bigint): bigint | null {
        const tree = this._trees.get(address);
        if (tree === undefined) {
            throw new Error(`Merkle tree is not registered for the address ${address.toString()}`);
        }
        const leafIndex = TokamakL2MerkleTrees.getLeafIndex(key);
        if (value === 0n) {
            tree.update(leafIndex, NULL_LEAF);
            return null
        } else {
            const leaf = poseidon_raw([key, value]);
            tree.update(leafIndex, leaf);
            return leaf
        }
    }

    public getAddresses(): Address[] {
        return Array.from(this._trees.keys())
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map(addrBigint => createAddressFromBigInt(addrBigint))
    }

    public static getLeafIndex(key: bigint): number {
        return Number(key % BigInt(MAX_MT_LEAVES));
    }

    private _addMerkleTree(address: bigint, mt: IMT) {
        if (this._trees.get(address) !== undefined) {
            throw new Error('Cannot overwrite a Merkle tree at the same address')
        }
        this._trees.set(address, mt);
    }

    public getRoots(): bigint[] {
        return this.getAddresses().map((address) => {
            const tree = this._trees.get(bytesToBigInt(address.bytes));
            if (tree === undefined) {
                throw new Error(`Merkle tree is not registered for the address ${address.toString()}`);
            }
            return treeNodeToBigint(tree.root);
        });
    }

    public getProof(address: Address, key: bigint): IMTMerkleProof {
        const addressBigInt = bytesToBigInt(address.bytes);
        const tree = this._trees.get(addressBigInt);
        if (tree === undefined) {
            throw new Error(`Merkle tree is not registered for the address ${address.toString()}`);
        }
        return tree.createProof(TokamakL2MerkleTrees.getLeafIndex(key));
    }

    public static async buildFromTokamakL2StateManager(mpt: TokamakL2StateManager): Promise<TokamakL2MerkleTrees> {
        const tokamakL2MerkleTree = new TokamakL2MerkleTrees(mpt);
        const leaves = await mpt.convertLeavesIntoMerkleTreeLeavesForAddress()
        for (const [addressBigInt, members] of leaves.entries()) {
            if (members.size > MAX_MT_LEAVES) {
                throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${members.size} for address ${addHexPrefix(addressBigInt.toString(16).padStart(40, "0"))}`)
            }
            const mt = new IMT(poseidon_raw as IMTHashFunction, MT_DEPTH, NULL_LEAF, POSEIDON_INPUTS);
            tokamakL2MerkleTree._addMerkleTree(addressBigInt, mt);
            const keyByLeafIndex = new Map<number, bigint>();
            for (const [key, value] of members.entries()) {
                const leafIndex = TokamakL2MerkleTrees.getLeafIndex(key);
                const existingKey = keyByLeafIndex.get(leafIndex);
                if (existingKey !== undefined && existingKey !== key) {
                    throw new Error(`Conflicting leaf indexes for address ${addHexPrefix(addressBigInt.toString(16).padStart(40, "0"))}: keys ${existingKey.toString()} and ${key.toString()} map to leaf index ${leafIndex}`)
                }
                keyByLeafIndex.set(leafIndex, key);
                tokamakL2MerkleTree.update(addressBigInt, key, value);
            }
        }
        return tokamakL2MerkleTree
    }
}
