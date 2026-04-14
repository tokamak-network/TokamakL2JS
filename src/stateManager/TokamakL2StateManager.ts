import { MerkleStateManager } from "@ethereumjs/statemanager";
import { MerkleTreeMembers, TokamakL2StateManagerRPCOpts, TokamakL2StateManagerSnapshotOpts } from "./types.js";
import { StateManagerInterface } from "@ethereumjs/common";
import { addHexPrefix, Address, bigIntToBytes, bigIntToHex, bytesToBigInt, bytesToHex, concatBytes, createAccount, createAddressFromString, hexToBigInt, hexToBytes, setLengthLeft, unpadBytes } from "@ethereumjs/util";
import { ethers } from "ethers";
import { RLP } from "@ethereumjs/rlp";
import { StateSnapshot, StorageKeysJson, StorageTrieDbEntryJson } from "../interface/channel/types.js";
import { TokamakL2MerkleTrees } from "./TokamakMerkleTrees.js";
import { assertSnapshotStorageShape, assertStorageEntryCapacity, deriveStorageTrieKeyPrefix } from "./utils.js";

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

    private _getInitializedStorageState(): {
        storageEntries: MerkleTreeMembers,
        storageKeyLeafIndexes: Map<bigint, Map<bigint, number>>,
        storageLeafIndexKeys: Map<bigint, Map<number, bigint>>,
        merkleTrees: TokamakL2MerkleTrees,
    } {
        if (this._storageEntries === null) {
            throw new Error('Storage entries are not initialized')
        }
        if (this._storageKeyLeafIndexes === null) {
            throw new Error('Storage key leaf indexes are not initialized')
        }
        if (this._storageLeafIndexKeys === null) {
            throw new Error('Storage leaf index keys are not initialized')
        }

        return {
            storageEntries: this._storageEntries,
            storageKeyLeafIndexes: this._storageKeyLeafIndexes,
            storageLeafIndexKeys: this._storageLeafIndexKeys,
            merkleTrees: this._getMerkleTrees(),
        }
    }

    private _commitResolvedStorageEntries(
        address: Address,
        entries: { keyBigInt: bigint, valueBigInt: bigint }[],
    ): void {
        const {
            storageEntries,
            storageKeyLeafIndexes,
            storageLeafIndexKeys,
            merkleTrees,
        } = this._getInitializedStorageState()
        const addressBigInt = bytesToBigInt(address.bytes)
        const storageEntriesForAddress = new Map<bigint, bigint>()
        const keyLeafIndexesForAddress = new Map<bigint, number>()
        const leafIndexKeysForAddress = new Map<number, bigint>()

        for (const entry of entries) {
            if (keyLeafIndexesForAddress.has(entry.keyBigInt)) {
                throw new Error(`Duplication in L2 MPT keys.`)
            }

            const leafIndex = TokamakL2MerkleTrees.getLeafIndex(entry.keyBigInt)
            const conflictingKey = leafIndexKeysForAddress.get(leafIndex)
            if (conflictingKey !== undefined && conflictingKey !== entry.keyBigInt) {
                throw new Error(`Leaf index collision for address ${address.toString()}: storage key ${entry.keyBigInt.toString()} conflicts with storage key ${conflictingKey.toString()} at leaf index ${leafIndex}`)
            }

            storageEntriesForAddress.set(entry.keyBigInt, entry.valueBigInt)
            keyLeafIndexesForAddress.set(entry.keyBigInt, leafIndex)
            leafIndexKeysForAddress.set(leafIndex, entry.keyBigInt)
        }

        storageEntries.set(addressBigInt, storageEntriesForAddress)
        storageKeyLeafIndexes.set(addressBigInt, keyLeafIndexesForAddress)
        storageLeafIndexKeys.set(addressBigInt, leafIndexKeysForAddress)
        merkleTrees.batchUpdate(addressBigInt, entries.map((entry) => ({
            key: entry.keyBigInt,
            value: entry.valueBigInt,
        })))
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

    private async _openAccount (address: Address): Promise<void> {
        const keccak256 = this.common.customCrypto.keccak256
        if (keccak256 === undefined) {
            throw new Error('customCrypto.keccak256 must be defined to initialize TokamakL2StateManager accounts')
        }
        const POSEIDON_RLP = keccak256(RLP.encode(new Uint8Array([])));
        const POSEIDON_NULL = keccak256(new Uint8Array(0));
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
            const account = await this.getAccount(address)
            if (account === undefined) {
                throw new Error(`Cannot initialize storage for missing account ${address.toString()}`)
            }

            const normalizedEntries: { key: Uint8Array, value: Uint8Array, keyBigInt: bigint, valueBigInt: bigint }[] = []

            for (const entry of storageEntriesForAddress) {
                const keyBigInt = bytesToBigInt(entry.key)
                const normalizedValue = unpadBytes(entry.value)
                const valueBigInt = normalizedValue.length === 0 ? 0n : bytesToBigInt(normalizedValue)
                normalizedEntries.push({
                    key: entry.key,
                    value: normalizedValue,
                    keyBigInt,
                    valueBigInt,
                })
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

            this._commitResolvedStorageEntries(address, normalizedEntries)
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
            assertStorageEntryCapacity(snapshot.storageKeys[idx].length, addressString)
            const address = createAddressFromString(addressString);
            const account = await this.getAccount(address)
            if (account === undefined) {
                throw new Error(`Cannot initialize storage for missing account ${address.toString()}`)
            }

            const trieDbOps = snapshot.storageTrieDb[idx].map((entry) => ({
                type: 'put' as const,
                key: addHexPrefix(entry.key).slice(2),
                value: hexToBytes(addHexPrefix(entry.value)),
            }))
            await this._getAccountTrie().database().db.batch(trieDbOps)

            account.storageRoot = hexToBytes(addHexPrefix(snapshot.storageTrieRoots[idx]))
            await this.putAccount(address, account)

            const storageTrie = this._getStorageTrie(address, account)
            const normalizedEntries: { keyBigInt: bigint, valueBigInt: bigint }[] = []

            for (const keyHex of snapshot.storageKeys[idx]) {
                const key = hexToBytes(addHexPrefix(keyHex))
                const keyBigInt = bytesToBigInt(key)

                const encodedValue = await storageTrie.get(key)
                const decodedValue = encodedValue === null ? new Uint8Array() : RLP.decode(encodedValue) as Uint8Array
                const normalizedValue = unpadBytes(decodedValue)
                const valueBigInt = normalizedValue.length === 0 ? 0n : bytesToBigInt(normalizedValue)

                normalizedEntries.push({ keyBigInt, valueBigInt })
            }

            this._commitResolvedStorageEntries(address, normalizedEntries)
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
        const {
            storageEntries,
            storageKeyLeafIndexes,
            storageLeafIndexKeys,
            merkleTrees,
        } = this._getInitializedStorageState()
        const addressBigInt = bytesToBigInt(address.bytes);
        const keyBigInt = bytesToBigInt(key);
        const valueBigInt = bytesToBigInt(value);
        const leafIndex = TokamakL2MerkleTrees.getLeafIndex(keyBigInt);
        let keyLeafIndexesForAddress = storageKeyLeafIndexes.get(addressBigInt);
        let leafIndexKeysForAddress = storageLeafIndexKeys.get(addressBigInt);

        if (keyLeafIndexesForAddress === undefined) {
            keyLeafIndexesForAddress = new Map()
            storageKeyLeafIndexes.set(addressBigInt, keyLeafIndexesForAddress)
        }
        if (leafIndexKeysForAddress === undefined) {
            leafIndexKeysForAddress = new Map()
            storageLeafIndexKeys.set(addressBigInt, leafIndexKeysForAddress)
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

        let storageEntriesForAddress = storageEntries.get(addressBigInt)
        if (registeredLeafIndex === undefined) {
            keyLeafIndexesForAddress.set(keyBigInt, leafIndex)
            leafIndexKeysForAddress.set(leafIndex, keyBigInt)
        }
        if (storageEntriesForAddress === undefined) {
            storageEntriesForAddress = new Map()
            storageEntries.set(addressBigInt, storageEntriesForAddress)
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
        const storageKeys: StorageKeysJson = [];
        const storageTrieRoots: string[] = [];
        const storageTrieDb: StorageTrieDbEntryJson[][] = [];
        const stateRoots: string[] = [];

        for (const address of storageAddresses) {
            const currentStorageEntries = this._storageEntries.get(bytesToBigInt(address.bytes));
            if (currentStorageEntries === undefined) {
                throw new Error(`Cannot capture snapshot for unregistered storage address: ${address.toString()}`)
            }

            storageKeys.push(
                Array.from(currentStorageEntries.keys()).map((key) =>
                    bytesToHex(setLengthLeft(bigIntToBytes(key), 32))
                )
            );
            const account = await this.getAccount(address)
            if (account === undefined) {
                throw new Error(`Cannot capture storage trie for missing account ${address.toString()}`)
            }

            const storageTrie = this._getStorageTrie(address, account)
            const currentStorageTrieRoot = bytesToHex(storageTrie.root())
            storageTrieRoots.push(currentStorageTrieRoot)
            if (currentStorageTrieRoot === bytesToHex(storageTrie.EMPTY_TRIE_ROOT)) {
                storageTrieDb.push([])
                stateRoots.push(bigIntToHex(merkleTrees.getRoot(address)));
                continue
            }

            const keyPrefix = deriveStorageTrieKeyPrefix(
                this._prefixStorageTrieKeys,
                address,
                this.common.customCrypto.keccak256,
            )
            const currentStorageTrieDb: StorageTrieDbEntryJson[] = []
            const seen = new Set<string>()

            for await (const { node, currentKey } of storageTrie.walkTrieIterable(storageTrie.root())) {
                const encoded = node.serialize()
                const isRoot = currentKey.length === 0
                if (!isRoot && encoded.length < 32) {
                    continue
                }

                let dbKey = isRoot ? storageTrie.root() : (storageTrie as unknown as { hash: (msg: Uint8Array) => Uint8Array }).hash(encoded)
                if (keyPrefix !== undefined) {
                    dbKey = concatBytes(keyPrefix, dbKey)
                }

                const keyHex = bytesToHex(dbKey)
                if (seen.has(keyHex)) {
                    continue
                }
                seen.add(keyHex)
                currentStorageTrieDb.push({
                    key: keyHex,
                    value: bytesToHex(encoded),
                })
            }

            storageTrieDb.push(currentStorageTrieDb)
            stateRoots.push(bigIntToHex(merkleTrees.getRoot(address)));
        }

        return {
            channelId: this._channelId,
            stateRoots,
            storageAddresses: storageAddresses.map(addr => addr.toString()),
            storageKeys,
            storageTrieRoots,
            storageTrieDb,
        };
    }
}
