import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeMembers, TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { IMT, IMTHashFunction, IMTMerkleProof, IMTNode } from "@zk-kit/imt"
import { addHexPrefix, Address, bytesToBigInt, bytesToHex, concatBytes, createAccount, createAddressFromBigInt, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { MAX_MT_LEAVES, MT_DEPTH, NULL_LEAF, POSEIDON_INPUTS } from "../interface/params/index.js";
import { poseidon, poseidon_raw } from "../crypto/index.js";
import { StateSnapshot, StorageEntriesJson } from "../interface/channel/types.js";
import { treeNodeToBigint } from "./utils.js";
import { createTokamakL2Common } from "../common/index.js";

export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _storageEntries: MerkleTreeMembers | null = null
    private _merkleTrees: TokamakL2MerkleTrees | null = null
    private _storageAddresses: Address[] | null = null

    private async _openAccount (address: Address): Promise<void> {
        const common = createTokamakL2Common();
        const POSEIDON_RLP = common.customCrypto.keccak256(RLP.encode(new Uint8Array([])));
        const POSEIDON_NULL = common.customCrypto.keccak256(new Uint8Array(0));
        const contractAccount = createAccount({nonce: 0n, balance: 0n, storageRoot: POSEIDON_RLP, codeHash: POSEIDON_NULL});
        await this.putAccount(address, contractAccount);
    }

    public async initTokamakExtendsFromRPC(rpcUrl: string, opts: TokamakL2StateManagerRPCOpts): Promise<void> {
        if (this._storageEntries !== null || this._storageAddresses !== null || this._merkleTrees !== null) {
            throw new Error('TokamakL2StateManager cannot be initialized twice')
        }
        this._storageAddresses = opts.storageAddresses;
        this._merkleTrees = new TokamakL2MerkleTrees(this._storageAddresses);
        
        await Promise.all(this._storageAddresses.map(addr => this._openAccount(addr)));
        const provider = new ethers.JsonRpcProvider(rpcUrl)
        for (const addr of opts.callCodeAddresses) {
            const byteCodeStr = await provider.getCode(addr.toString(), opts.blockNumber)
            await this.putCode(addr, hexToBytes(addHexPrefix(byteCodeStr)))
        }
        this._storageEntries = new Map();
        for (const [idx, keyPairs] of opts.initStorageKeys.entries()) {
            const address = opts.storageAddresses[idx];
            if (address === undefined) {
                throw new Error(`Storage address is missing for initStorageKeys index ${idx}.`)
            }
            if (await this.getAccount(address) === undefined) {
                throw new Error('TokamakL2StateManager is not initialized.')
            }
            const usedL1Keys = new Set<bigint>();
            const registeredL2KeyBigInts = new Set<bigint>();
            this._storageEntries.set(bytesToBigInt(address.bytes), new Map());
            for (const keys of keyPairs) {
                const keyL1BigInt = bytesToBigInt(keys.L1);
                const keyL2BigInt = bytesToBigInt(keys.L2);
                if (usedL1Keys.has(keyL1BigInt)) {
                    throw new Error(`Duplication in L1 MPT keys.`);
                }
                if (registeredL2KeyBigInts.has(keyL2BigInt)) {
                    throw new Error(`Duplication in L2 MPT keys.`);
                }

                const v = await provider.getStorage(address.toString(), bytesToBigInt(keys.L1), opts.blockNumber);
                const vBytes = hexToBytes(addHexPrefix(v));
                await this.putStorage(address, keys.L2, vBytes);

                usedL1Keys.add(keyL1BigInt);
                registeredL2KeyBigInts.add(keyL2BigInt);
            }
        }
        await this.flush();
    }

    public async initTokamakExtendsFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerSnapshotOpts): Promise<void> {
        if (this._storageEntries !== null || this._storageAddresses !== null || this._merkleTrees !== null) {
            throw new Error('TokamakL2StateManager cannot be initialized twice')
        }
        this._storageAddresses = snapshot.storageAddresses.map(addrStr => createAddressFromString(addHexPrefix(addrStr)));
        this._merkleTrees = new TokamakL2MerkleTrees(this._storageAddresses);
        await Promise.all(this._storageAddresses.map(addr => this._openAccount(addr)));
        for (const codeInfo of opts.contractCodes ?? []) {
            await this.putCode(codeInfo.address, hexToBytes(codeInfo.code));
        }
        if (this._storageEntries !== null) {
            throw new Error('Cannot rewrite registered keys')
        }
        if (snapshot.stateRoots.length !== snapshot.storageAddresses.length || snapshot.storageAddresses.length !== snapshot.storageEntries.length) {
            throw new Error('Snapshot is expected to have a set of storage entries for each state root')
        }
        
        this._storageEntries = new Map();
        for (const [idx, addressString] of snapshot.storageAddresses.entries()) {
            if (snapshot.storageEntries[idx].length > MAX_MT_LEAVES) {
                throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${snapshot.storageEntries[idx].length} for address ${addressString}`)
            }
            const address = createAddressFromString(addressString);
            this._storageEntries.set(bytesToBigInt(address.bytes), new Map());
            for (const entry of snapshot.storageEntries[idx]) {
                const vBytes = hexToBytes(addHexPrefix(entry.value));
                const keyBytes = hexToBytes(addHexPrefix(entry.key));
                await this.putStorage(address, keyBytes, vBytes);
            }
        }
        await this.flush();
        
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

    public async captureStateSnapshot(prevSnapshot: StateSnapshot): Promise<StateSnapshot> {
        if (this.storageEntries === null) {
            throw new Error('Storage entries are not initialized.')
        }
        if (prevSnapshot.stateRoots.length !== prevSnapshot.storageAddresses.length || prevSnapshot.storageAddresses.length !== prevSnapshot.storageEntries.length) {
            throw new Error('Snapshot is expected to have a set of storage entries for each state root')
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
        const storageKeysByAddress = new Map<string, bigint[]>(
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

        const storageEntries: StorageEntriesJson = [];
        const stateRoots: string[] = [];

        for (const addressString of prevSnapshot.storageAddresses) {
            const address = createAddressFromString(addressString);
            const addressKey = address.toString().toLowerCase();
            const currentStorageKeys = storageKeysByAddress.get(addressKey);
            const currentRoot = rootByAddress.get(addressKey);

            if (currentStorageKeys === undefined || currentRoot === undefined) {
                throw new Error(`Cannot capture snapshot for unregistered storage address: ${addressString}`)
            }

            storageEntries.push(
                await Promise.all(
                    currentStorageKeys.map((key) => getUpdatedEntry(address, hexToBytes(addHexPrefix(key.toString(16).padStart(64, "0")))))
                )
            );
            stateRoots.push(currentRoot);
        }

        return {
            channelId: prevSnapshot.channelId,
            stateRoots,
            storageAddresses: [...prevSnapshot.storageAddresses],
            storageEntries,
        };
    }
}

export class TokamakL2MerkleTrees {
    private _trees: Map<bigint, IMT>; // Map<address, tree>

    constructor(addresses: Address[]) {
        this._trees = new Map<bigint, IMT>();
        addresses.map(addr => this._trees.set(bytesToBigInt(addr.bytes), new IMT(poseidon_raw as IMTHashFunction, MT_DEPTH, NULL_LEAF, POSEIDON_INPUTS)));
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

    public static getLeafIndex(key: bigint): number {
        return Number(key % BigInt(MAX_MT_LEAVES));
    }

    public getRoot(address: Address): bigint {
        const tree = this._trees.get(bytesToBigInt(address.bytes));
        if (tree === undefined) {
            throw new Error(`Merkle tree is not registered for the address ${address.toString()}`);
        }
        return treeNodeToBigint(tree.root);
    }

    public getRoots(addresses: Address[]): bigint[] {
        return addresses.map(addr => this.getRoot(addr));
    }

    public getProof(address: Address, key: bigint): IMTMerkleProof {
        const addressBigInt = bytesToBigInt(address.bytes);
        const tree = this._trees.get(addressBigInt);
        if (tree === undefined) {
            throw new Error(`Merkle tree is not registered for the address ${address.toString()}`);
        }
        return tree.createProof(TokamakL2MerkleTrees.getLeafIndex(key));
    }
}
