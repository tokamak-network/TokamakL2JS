import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeMembers, TokamakL2StateManagerOpts } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { SMT, type MerkleProof } from "@zk-kit/smt"
import { addHexPrefix, Address, bytesToBigInt, bytesToHex, createAccount, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { poseidonChainCompress } from "../crypto/index.js";
import { StateSnapshot } from "../interface/channel/types.js";

export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _cachedOpts: TokamakL2StateManagerOpts | null = null
    private _registeredMembers: MerkleTreeMembers | null = null
    private _lastMerkleTrees: TokamakL2MerkleTrees | null = null

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
        if (this._registeredMembers !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        this._registeredMembers = new Map();
        for (const keysByAddress of opts.initStorageKeys) {
            if (await this.getAccount(keysByAddress.address) === undefined) {
                throw new Error('TokamakL2StateManager is not initialized.')
            }
            const usedL1Keys = new Set<bigint>();
            const registeredL2KeyBigInts = new Set<bigint>();
            this._registeredMembers.set(bytesToBigInt(keysByAddress.address.bytes), new Map());
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
        if (this._registeredMembers !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        if (snapshot.stateRoots.length !== snapshot.registeredMembers.length) {
            throw new Error('Snapshot is expected to have a set of registered members for each state root')
        }
        this._registeredMembers = new Map();
        for (const registeredMembersForAddress of snapshot.registeredMembers) {
            const address = createAddressFromString(registeredMembersForAddress.storageAddress);
            this._registeredMembers.set(bytesToBigInt(address.bytes), new Map());
            for (const entry of registeredMembersForAddress.members) {
                const vBytes = hexToBytes(addHexPrefix(entry.value));
                const keyBytes = hexToBytes(addHexPrefix(entry.key));
                await this.putStorage(address, keyBytes, vBytes);
            }
        }
        await this.flush();
    }

    async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
        await super.putStorage(address, key, value)
        if (this._registeredMembers !== null) {
            const addressBigInt = bytesToBigInt(address.bytes)
            let registeredKeysForAddress = this._registeredMembers.get(addressBigInt)
            if (registeredKeysForAddress === undefined) {
                registeredKeysForAddress = new Map()
                this._registeredMembers.set(addressBigInt, registeredKeysForAddress)
            }
            registeredKeysForAddress.set(bytesToBigInt(key), bytesToBigInt(value))
        }
        if (this._lastMerkleTrees !== null) {
            await this._getUpdatedMerkleTree()
        }
    }

    public async convertLeavesIntoMerkleTreeLeavesForAddress(): Promise<MerkleTreeMembers> {
        const leaves: MerkleTreeMembers = new Map();
        for (const [addressBigInt, registeredKeysForAddress] of this.registeredKeys.entries()){ 
            const address = createAddressFromString(addHexPrefix(addressBigInt.toString(16).padStart(40, "0")));
            const leavesForAddress = new Map<bigint, bigint>();
            for (const key of registeredKeysForAddress.keys()) {
                const keyBytes = hexToBytes(addHexPrefix(key.toString(16).padStart(64, "0")));
                const val = await this.getStorage(address, keyBytes);
                leavesForAddress.set(key, bytesToBigInt(val));
            }
            leaves.set(addressBigInt, leavesForAddress);
        }
        return leaves
    }

    private async _getUpdatedMerkleTree(): Promise<TokamakL2MerkleTrees> {
        await this.flush();
        this._lastMerkleTrees = await TokamakL2MerkleTrees.buildFromTokamakL2StateManager(this)
        return this._lastMerkleTrees
    }

    public get registeredKeys() {return this._registeredMembers}
    public get lastMerkleTrees(): TokamakL2MerkleTrees {
        if (this._lastMerkleTrees === null) {
            throw new Error('Merkle trees are not initialized.')
        }
        return this._lastMerkleTrees
    }
    public get cachedOpts() {return this._cachedOpts}

    public async captureStateSnapshot(prevSnapshot: StateSnapshot): Promise<StateSnapshot> {
        if (this.registeredKeys === null) {
            throw new Error('Registered storage keys are not initialized.')
        }
        if (prevSnapshot.stateRoots.length !== prevSnapshot.registeredMembers.length) {
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

        const merkleTrees = this.lastMerkleTrees;
        const registeredKeysByAddress = new Map<string, bigint[]>(
            Array.from(this.registeredKeys.entries()).map(([addressBigInt, members]) => [
                createAddressFromString(addHexPrefix(addressBigInt.toString(16).padStart(40, "0"))).toString().toLowerCase(),
                Array.from(members.keys()),
            ])
        );
        const rootByAddress = new Map<string, string>();
        for (const [idx, address] of merkleTrees.addresses.entries()) {
            rootByAddress.set(
                address.toString().toLowerCase(),
                (merkleTrees.merkleTrees[idx].root as bigint).toString(16)
            );
        }

        const registeredMembers: { storageAddress: string; members: { key: string; value: string }[] }[] = [];
        const stateRoots: string[] = [];

        for (const registeredMembersForAddress of prevSnapshot.registeredMembers) {
            const address = createAddressFromString(registeredMembersForAddress.storageAddress);
            const addressKey = address.toString().toLowerCase();
            const currentRegisteredKeys = registeredKeysByAddress.get(addressKey);
            const currentRoot = rootByAddress.get(addressKey);

            if (currentRegisteredKeys === undefined || currentRoot === undefined) {
                throw new Error(`Cannot capture snapshot for unregistered storage address: ${registeredMembersForAddress.storageAddress}`)
            }

            registeredMembers.push({
                storageAddress: registeredMembersForAddress.storageAddress,
                members: await Promise.all(
                    currentRegisteredKeys.map((key) => getUpdatedEntry(address, hexToBytes(addHexPrefix(key.toString(16).padStart(64, "0")))))
                ),
            });
            stateRoots.push(currentRoot);
        }

        return {
            channelId: prevSnapshot.channelId,
            stateRoots,
            registeredMembers,
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

    public getProof(treeIndex: [number, bigint]): MerkleProof {
        const tree = this.merkleTrees[treeIndex[0]];
        if (tree === undefined) {
            throw new Error(`Merkle tree is not registered: ${treeIndex[0]}`);
        }
        return tree.createProof(treeIndex[1]) as MerkleProof;
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
