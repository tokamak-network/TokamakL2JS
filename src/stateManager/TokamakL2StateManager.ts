import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeMembers, TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { IMT, IMTHashFunction, IMTMerkleProof } from "@zk-kit/imt"
import { addHexPrefix, Address, bigIntToBytes, bigIntToHex, bytesToBigInt, bytesToHex, concatBytes, createAccount, createAddressFromBigInt, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { poseidon_raw } from "../crypto/index.js";
import { StateSnapshot, StorageEntriesJson } from "../interface/channel/types.js";
import { treeNodeToBigint } from "./utils.js";
import { createTokamakL2Common } from "../common/index.js";
import { MAX_MT_LEAVES, MT_DEPTH, NULL_LEAF } from "../interface/params/stateManager.js";
import { POSEIDON_INPUTS } from "../interface/params/crypto.js";
import { jubjub } from "@noble/curves/misc";

export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _storageEntries: MerkleTreeMembers | null = null
    private _merkleTrees: TokamakL2MerkleTrees | null = null
    private _storageAddresses: Address[] | null = null
    private _storageKeyLeafIndexes: Map<bigint, Map<bigint, number>> | null = null
    private _channelId?: number;

    private async _openAccount (address: Address): Promise<void> {
        const common = createTokamakL2Common();
        const POSEIDON_RLP = common.customCrypto.keccak256(RLP.encode(new Uint8Array([])));
        const POSEIDON_NULL = common.customCrypto.keccak256(new Uint8Array(0));
        const contractAccount = createAccount({nonce: 0n, balance: 0n, storageRoot: POSEIDON_RLP, codeHash: POSEIDON_NULL});
        await this.putAccount(address, contractAccount);
    }

    public async initTokamakExtendsFromRPC(rpcUrl: string, opts: TokamakL2StateManagerRPCOpts): Promise<void> {
        if (this._storageEntries !== null || this._storageAddresses !== null || this._merkleTrees !== null || this._storageKeyLeafIndexes !== null) {
            throw new Error('TokamakL2StateManager cannot be initialized twice')
        }
        this._storageAddresses = opts.storageConfig.map((entry) => entry.address);
        this._merkleTrees = new TokamakL2MerkleTrees(this._storageAddresses);
        
        await Promise.all(this._storageAddresses.map(addr => this._openAccount(addr)));
        const provider = new ethers.JsonRpcProvider(rpcUrl)
        for (const addr of opts.callCodeAddresses) {
            const byteCodeStr = await provider.getCode(addr.toString(), opts.blockNumber)
            await this.putCode(addr, hexToBytes(addHexPrefix(byteCodeStr)))
        }
        this._storageEntries = new Map();
        this._storageKeyLeafIndexes = new Map();
        for (const storageConfig of opts.storageConfig) {
            const address = storageConfig.address;
            const usedL1Keys = new Set<bigint>();
            const registeredL2KeyBigInts = new Set<bigint>();
            const addressBigInt = bytesToBigInt(address.bytes);
            this._storageEntries.set(addressBigInt, new Map());
            this._storageKeyLeafIndexes.set(addressBigInt, new Map());
            for (const keys of storageConfig.keyPairs) {
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
        if (this._storageEntries !== null || this._storageAddresses !== null || this._merkleTrees !== null || this._storageKeyLeafIndexes !== null) {
            throw new Error('TokamakL2StateManager cannot be initialized twice')
        }
        if (snapshot.stateRoots.length !== snapshot.storageAddresses.length || snapshot.storageAddresses.length !== snapshot.storageEntries.length) {
            throw new Error('Snapshot is expected to have a set of storage entries for each state root')
        }
        this._channelId = snapshot.channelId;
        this._storageAddresses = snapshot.storageAddresses.map(addrStr => createAddressFromString(addrStr));
        this._merkleTrees = new TokamakL2MerkleTrees(this._storageAddresses);
        await Promise.all(this._storageAddresses.map(addr => this._openAccount(addr)));
        for (const codeInfo of opts.contractCodes) {
            await this.putCode(codeInfo.address, hexToBytes(codeInfo.code));
        }
        
        this._storageEntries = new Map();
        this._storageKeyLeafIndexes = new Map();
        for (const [idx, addressString] of snapshot.storageAddresses.entries()) {
            if (snapshot.storageEntries[idx].length > MAX_MT_LEAVES) {
                throw new Error(`Allowed maximum number of storage slots = ${MAX_MT_LEAVES}, but taking ${snapshot.storageEntries[idx].length} for address ${addressString}`)
            }
            const address = createAddressFromString(addressString);
            const addressBigInt = bytesToBigInt(address.bytes);
            this._storageEntries.set(addressBigInt, new Map());
            this._storageKeyLeafIndexes.set(addressBigInt, new Map());
            for (const entry of snapshot.storageEntries[idx]) {
                const vBytes = hexToBytes(addHexPrefix(entry.value));
                const keyBytes = hexToBytes(addHexPrefix(entry.key));
                await this.putStorage(address, keyBytes, vBytes);
            }
        }
        await this.flush();
        const roots = this._merkleTrees.getRoots(this._storageAddresses);

        for (const [idx, addressString] of snapshot.storageAddresses.entries()) {
            if (roots[idx] === undefined) {
                throw new Error(`Merkle tree is not registered for the address ${addressString}`)
            }
            if (roots[idx] !== hexToBigInt(addHexPrefix(snapshot.stateRoots[idx]))) {
                throw new Error(`Creating TokamakL2StateManager using StateSnapshot fails: (provided root: ${snapshot.stateRoots[idx]}, reconstructed root: ${bigIntToHex(roots[idx])}) for storage ${addressString} at index ${idx}`)
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
        if (this._storageKeyLeafIndexes === null) {
            throw new Error('Storage key leaf indexes are not initialized')
        }
        const addressBigInt = bytesToBigInt(address.bytes);
        const keyBigInt = bytesToBigInt(key);
        const valueBigInt = bytesToBigInt(value);
        const leafIndex = TokamakL2MerkleTrees.getLeafIndex(keyBigInt);
        let keyLeafIndexesForAddress = this._storageKeyLeafIndexes.get(addressBigInt);

        if (keyLeafIndexesForAddress === undefined) {
            keyLeafIndexesForAddress = new Map()
            this._storageKeyLeafIndexes.set(addressBigInt, keyLeafIndexesForAddress)
        }

        const registeredLeafIndex = keyLeafIndexesForAddress.get(keyBigInt);
        if (registeredLeafIndex === undefined) {
            for (const [registeredStorageKey, registeredLeafIndex] of keyLeafIndexesForAddress.entries()) {
                if (registeredLeafIndex === leafIndex) {
                    throw new Error(`Leaf index collision for address ${address.toString()}: storage key ${keyBigInt.toString()} conflicts with storage key ${registeredStorageKey.toString()} at leaf index ${leafIndex}`)
                }
            }
        }

        await super.putStorage(address, key, value);
        await this.flush();
        const leaf = this._merkleTrees.update(addressBigInt, keyBigInt, valueBigInt);

        let storageEntriesForAddress = this._storageEntries.get(addressBigInt)
        if (registeredLeafIndex === undefined) {
            keyLeafIndexesForAddress.set(keyBigInt, leafIndex)
        }
        if (storageEntriesForAddress === undefined) {
            storageEntriesForAddress = new Map()
            this._storageEntries.set(addressBigInt, storageEntriesForAddress)
        }
        storageEntriesForAddress.set(keyBigInt, valueBigInt)
    }

    public get storageEntries() {return this._storageEntries}
    public get storageAddresses(): Address[] {
        if (this._storageAddresses === null) {
            throw new Error('Storage addresses are not initialized.')
        }
        return this._storageAddresses
    }
    public get merkleTrees(): TokamakL2MerkleTrees {
        if (this._merkleTrees === null) {
            throw new Error('Merkle trees are not initialized.')
        }
        return this._merkleTrees
    }

    public async captureStateSnapshot(): Promise<StateSnapshot> {
        if (this._storageEntries === null) {
            throw new Error('Storage entries are not initialized.')
        }
        if (this._channelId === undefined) {
            throw new Error('Channel ID is not identified.')
        }
        const merkleTrees = this._merkleTrees;
        const storageEntries: StorageEntriesJson = [];
        const stateRoots: string[] = [];

        for (const address of this._storageAddresses) {
            const currentStorageEntries = this._storageEntries.get(bytesToBigInt(address.bytes));
            if (currentStorageEntries === undefined) {
                throw new Error(`Cannot capture snapshot for unregistered storage address: ${address.toString()}`)
            }

            storageEntries.push(
                await Promise.all(
                    Array.from(currentStorageEntries.keys()).map(async (key) => {
                        const keyBytes = setLengthLeft(bigIntToBytes(key), 32);
                        const value = await this.getStorage(address, keyBytes);
                        return {
                            key: bytesToHex(keyBytes),
                            value: bytesToHex(value),
                        };
                    })
                )
            );
            stateRoots.push(bigIntToHex(merkleTrees.getRoot(address)));
        }

        return {
            channelId: this._channelId,
            stateRoots,
            storageAddresses: this._storageAddresses.map(addr => addr.toString()),
            storageEntries,
        };
    }
}

export class TokamakL2MerkleTrees {
    private _trees: Map<bigint, IMT>; // Map<address, tree>

    constructor(addresses: Address[]) {
        this._trees = new Map<bigint, IMT>();
        const leaves = Array(MAX_MT_LEAVES).fill(NULL_LEAF);
        addresses.forEach(addr => this._trees.set(bytesToBigInt(addr.bytes), new IMT(poseidon_raw as IMTHashFunction, MT_DEPTH, NULL_LEAF, POSEIDON_INPUTS, leaves)));
    }

    public get trees() {
        return this._trees
    }
    
    public update(address: bigint, key: bigint, value: bigint): bigint {
        const tree = this._trees.get(address);
        if (tree === undefined) {
            throw new Error(`Merkle tree is not registered for the address ${address.toString()}`);
        }
        const leafIndex = TokamakL2MerkleTrees.getLeafIndex(key);
        const leaf = value % jubjub.Point.Fp.ORDER;
        tree.update(leafIndex, leaf);
        return leaf
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
