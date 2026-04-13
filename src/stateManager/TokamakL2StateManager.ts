import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeMembers, TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { addHexPrefix, Address, bigIntToBytes, bigIntToHex, bytesToBigInt, bytesToHex, createAccount, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft, unpadBytes } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { StateSnapshot, StorageEntriesJson } from "../interface/channel/types.js";
import { poseidon } from "../crypto/index.js";
import { TokamakL2MerkleTrees } from "./TokamakMerkleTrees.js";
import { assertSnapshotStorageShape, assertStorageEntryCapacity } from "./utils.js";

export class TokamakL2StateManager extends MerkleStateManager implements StateManagerInterface {
    private _storageEntries: MerkleTreeMembers | null = null
    private _merkleTrees: TokamakL2MerkleTrees | null = null
    private _storageAddresses: Address[] | null = null
    private _storageKeyLeafIndexes: Map<bigint, Map<bigint, number>> | null = null
    private _storageLeafIndexKeys: Map<bigint, Map<number, bigint>> | null = null
    private _channelId?: number;

    private _getStorageAddresses(): Address[] {
        if (this._storageAddresses == null) {
            throw new Error('Storage addresses are not initialized.')
        }

        return this._storageAddresses
    }

    private _getMerkleTrees(): TokamakL2MerkleTrees {
        if (this._merkleTrees == null) {
            throw new Error('Merkle trees are not initialized.')
        }

        return this._merkleTrees
    }

    private async _initializeForAddresses(addresses: Address[]): Promise<void> {
        if (this._storageEntries !== null || this._storageAddresses !== null || this._merkleTrees !== null || this._storageKeyLeafIndexes !== null || this._storageLeafIndexKeys !== null) {
            throw new Error('TokamakL2StateManager cannot be initialized twice')
        }
        this._storageAddresses = addresses
        this._merkleTrees = new TokamakL2MerkleTrees(addresses)
        this._storageEntries = new Map()
        this._storageKeyLeafIndexes = new Map()
        this._storageLeafIndexKeys = new Map()
        await Promise.all(addresses.map(addr => this._openAccount(addr)))
    }

    private async _ingestStorageEntries(address: Address, entries: { key: Uint8Array, value: Uint8Array }[]): Promise<void> {
        if (this._storageEntries === null) {
            throw new Error('Storage entries are not initialized')
        }
        if (this._storageKeyLeafIndexes === null) {
            throw new Error('Storage key leaf indexes are not initialized')
        }
        if (this._storageLeafIndexKeys === null) {
            throw new Error('Storage leaf index keys are not initialized')
        }
        const merkleTrees = this._getMerkleTrees()
        const account = await this.getAccount(address)
        if (account === undefined) {
            throw new Error(`Cannot initialize storage for missing account ${address.toString()}`)
        }

        const addressBigInt = bytesToBigInt(address.bytes)
        const storageEntriesForAddress = new Map<bigint, bigint>()
        const keyLeafIndexesForAddress = new Map<bigint, number>()
        const leafIndexKeysForAddress = new Map<number, bigint>()
        const normalizedEntries: { key: Uint8Array, value: Uint8Array, keyBigInt: bigint, valueBigInt: bigint }[] = []

        for (const entry of entries) {
            const keyBigInt = bytesToBigInt(entry.key);
            if (keyLeafIndexesForAddress.has(keyBigInt)) {
                throw new Error(`Duplication in L2 MPT keys.`);
            }
            const leafIndex = TokamakL2MerkleTrees.getLeafIndex(keyBigInt)
            const conflictingKey = leafIndexKeysForAddress.get(leafIndex)
            if (conflictingKey !== undefined && conflictingKey !== keyBigInt) {
                throw new Error(`Leaf index collision for address ${address.toString()}: storage key ${keyBigInt.toString()} conflicts with storage key ${conflictingKey.toString()} at leaf index ${leafIndex}`)
            }

            const normalizedValue = unpadBytes(entry.value)
            const valueBigInt = normalizedValue.length === 0 ? 0n : bytesToBigInt(normalizedValue)
            normalizedEntries.push({
                key: entry.key,
                value: normalizedValue,
                keyBigInt,
                valueBigInt,
            })
            storageEntriesForAddress.set(keyBigInt, valueBigInt)
            keyLeafIndexesForAddress.set(keyBigInt, leafIndex)
            leafIndexKeysForAddress.set(leafIndex, keyBigInt)
        }

        await this._modifyContractStorage(address, account, async (storageTrie, done) => {
            for (const entry of normalizedEntries) {
                if (entry.value.length === 0) {
                    await storageTrie.del(entry.key)
                } else {
                    await storageTrie.put(entry.key, RLP.encode(entry.value))
                }
            }
            done()
        })

        this._storageEntries.set(addressBigInt, storageEntriesForAddress)
        this._storageKeyLeafIndexes.set(addressBigInt, keyLeafIndexesForAddress)
        this._storageLeafIndexKeys.set(addressBigInt, leafIndexKeysForAddress)

        for (const entry of normalizedEntries) {
            merkleTrees.update(addressBigInt, entry.keyBigInt, entry.valueBigInt)
        }
    }

    private async _openAccount (address: Address): Promise<void> {
        const POSEIDON_RLP = poseidon(RLP.encode(new Uint8Array([])));
        const POSEIDON_NULL = poseidon(new Uint8Array(0));
        const contractAccount = createAccount({nonce: 0n, balance: 0n, storageRoot: POSEIDON_RLP, codeHash: POSEIDON_NULL});
        await this.putAccount(address, contractAccount);
    }

    public async initTokamakExtendsFromRPC(rpcUrl: string, opts: TokamakL2StateManagerRPCOpts): Promise<void> {
        for (const storageConfig of opts.storageConfig) {
            assertStorageEntryCapacity(storageConfig.keyPairs.length, storageConfig.address.toString())
        }
        await this._initializeForAddresses(opts.storageConfig.map((entry) => entry.address))
        const provider = new ethers.JsonRpcProvider(rpcUrl)
        for (const addr of opts.callCodeAddresses) {
            const byteCodeStr = await provider.getCode(addr.toString(), opts.blockNumber)
            await this.putCode(addr, hexToBytes(addHexPrefix(byteCodeStr)))
        }
        for (const storageConfig of opts.storageConfig) {
            const address = storageConfig.address;
            const usedL1Keys = new Set<bigint>();
            const storageEntriesForAddress: { key: Uint8Array, value: Uint8Array }[] = [];
            for (const keys of storageConfig.keyPairs) {
                const keyL1BigInt = bytesToBigInt(keys.L1);
                if (usedL1Keys.has(keyL1BigInt)) {
                    throw new Error(`Duplication in L1 MPT keys.`);
                }
                const v = await provider.getStorage(address.toString(), bytesToBigInt(keys.L1), opts.blockNumber);
                storageEntriesForAddress.push({
                    key: keys.L2,
                    value: hexToBytes(addHexPrefix(v)),
                });
                usedL1Keys.add(keyL1BigInt);
            }
            await this._ingestStorageEntries(address, storageEntriesForAddress)
        }
        await this.flush();
    }

    public async initTokamakExtendsFromSnapshot(snapshot: StateSnapshot, opts: TokamakL2StateManagerSnapshotOpts): Promise<void> {
        assertSnapshotStorageShape(snapshot)
        this._channelId = snapshot.channelId;
        const storageAddresses = snapshot.storageAddresses.map(addrStr => createAddressFromString(addrStr))
        await this._initializeForAddresses(storageAddresses)
        for (const codeInfo of opts.contractCodes) {
            await this.putCode(codeInfo.address, hexToBytes(codeInfo.code));
        }
        
        for (const [idx, addressString] of snapshot.storageAddresses.entries()) {
            assertStorageEntryCapacity(snapshot.storageEntries[idx].length, addressString)
            const address = createAddressFromString(addressString);
            await this._ingestStorageEntries(address, snapshot.storageEntries[idx].map((entry) => ({
                key: hexToBytes(addHexPrefix(entry.key)),
                value: hexToBytes(addHexPrefix(entry.value)),
            })))
        }
        await this.flush();
        const roots = this._getMerkleTrees().getRoots(storageAddresses);

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
        if (this._storageEntries === null) {
            throw new Error('Storage entries are not fetched')
        }
        if (this._storageKeyLeafIndexes === null) {
            throw new Error('Storage key leaf indexes are not initialized')
        }
        if (this._storageLeafIndexKeys === null) {
            throw new Error('Storage leaf index keys are not initialized')
        }
        const merkleTrees = this._getMerkleTrees();
        const addressBigInt = bytesToBigInt(address.bytes);
        const keyBigInt = bytesToBigInt(key);
        const valueBigInt = bytesToBigInt(value);
        const leafIndex = TokamakL2MerkleTrees.getLeafIndex(keyBigInt);
        let keyLeafIndexesForAddress = this._storageKeyLeafIndexes.get(addressBigInt);
        let leafIndexKeysForAddress = this._storageLeafIndexKeys.get(addressBigInt);

        if (keyLeafIndexesForAddress === undefined) {
            keyLeafIndexesForAddress = new Map()
            this._storageKeyLeafIndexes.set(addressBigInt, keyLeafIndexesForAddress)
        }
        if (leafIndexKeysForAddress === undefined) {
            leafIndexKeysForAddress = new Map()
            this._storageLeafIndexKeys.set(addressBigInt, leafIndexKeysForAddress)
        }

        const registeredLeafIndex = keyLeafIndexesForAddress.get(keyBigInt);
        if (registeredLeafIndex === undefined) {
            const conflictingKey = leafIndexKeysForAddress.get(leafIndex)
            if (conflictingKey !== undefined && conflictingKey !== keyBigInt) {
                throw new Error(`Leaf index collision for address ${address.toString()}: storage key ${keyBigInt.toString()} conflicts with storage key ${conflictingKey.toString()} at leaf index ${leafIndex}`)
            }
        }

        await super.putStorage(address, key, value);
        await this.flush();
        merkleTrees.update(addressBigInt, keyBigInt, valueBigInt);

        let storageEntriesForAddress = this._storageEntries.get(addressBigInt)
        if (registeredLeafIndex === undefined) {
            keyLeafIndexesForAddress.set(keyBigInt, leafIndex)
            leafIndexKeysForAddress.set(leafIndex, keyBigInt)
        }
        if (storageEntriesForAddress === undefined) {
            storageEntriesForAddress = new Map()
            this._storageEntries.set(addressBigInt, storageEntriesForAddress)
        }
        storageEntriesForAddress.set(keyBigInt, valueBigInt)
    }

    public get storageEntries() {return this._storageEntries}
    public get storageAddresses(): Address[] {
        return this._getStorageAddresses()
    }
    public get merkleTrees(): TokamakL2MerkleTrees {
        return this._getMerkleTrees()
    }

    public async captureStateSnapshot(): Promise<StateSnapshot> {
        if (this._storageEntries === null) {
            throw new Error('Storage entries are not initialized.')
        }
        if (this._channelId === undefined) {
            throw new Error('Channel ID is not identified.')
        }
        const merkleTrees = this._getMerkleTrees();
        const storageAddresses = this._getStorageAddresses();
        const storageEntries: StorageEntriesJson = [];
        const stateRoots: string[] = [];

        for (const address of storageAddresses) {
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
            storageAddresses: storageAddresses.map(addr => addr.toString()),
            storageEntries,
        };
    }
}
