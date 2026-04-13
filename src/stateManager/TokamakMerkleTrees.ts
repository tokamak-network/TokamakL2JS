import { IMTHashFunction, IMTMerkleProof, IMTNode } from "@zk-kit/imt";
import { Address, bytesToBigInt } from "@ethereumjs/util";
import { poseidon_raw } from "../crypto/index.js";
import { MAX_MT_LEAVES, MT_DEPTH, NULL_LEAF } from "../interface/params/stateManager.js";
import { POSEIDON_INPUTS } from "../interface/params/crypto.js";
import { jubjub } from "@noble/curves/misc";
import { treeNodeToBigint } from "./utils.js";

const assertFunction = (value: unknown, name: string): void => {
    if (typeof value !== "function") {
        throw new TypeError(`${name} is not a function`)
    }
}

const assertNumber = (value: unknown, name: string): void => {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new TypeError(`${name} is not a number`)
    }
}

const assertObject = (value: unknown, name: string): void => {
    if (typeof value !== "object" || value === null) {
        throw new TypeError(`${name} is not an object`)
    }
}

const assertArray = (value: unknown, name: string): void => {
    if (!Array.isArray(value)) {
        throw new TypeError(`${name} is not an array`)
    }
}

const assertNode = (value: unknown, name: string): void => {
    if (typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") {
        throw new TypeError(`${name} must be a number, string, or bigint`)
    }
}

/**
 * TokamakSparseMerkleTree mirrors the public shape of IMT while storing only
 * non-zero nodes. Missing nodes are interpreted as the precomputed zero value
 * for their level, which makes random updates possible without dense prefill.
 */
export class TokamakSparseMerkleTree {
    private readonly _nodes: Map<number, IMTNode>[]
    private readonly _zeroes: IMTNode[]
    private readonly _rootZero: IMTNode
    private readonly _hash: IMTHashFunction
    private readonly _depth: number
    private readonly _arity: number
    private _insertIndex: number

    constructor(hash: IMTHashFunction, depth: number, zeroValue: IMTNode, arity = 2, leaves: IMTNode[] = []) {
        assertFunction(hash, "hash")
        assertNumber(depth, "depth")
        assertNode(zeroValue, "zeroValue")
        assertNumber(arity, "arity")
        assertObject(leaves, "leaves")

        if (!Number.isInteger(depth) || depth < 0) {
            throw new Error("depth must be a non-negative integer")
        }
        if (!Number.isInteger(arity) || arity < 2) {
            throw new Error("arity must be an integer greater than or equal to 2")
        }

        this._hash = hash
        this._depth = depth
        this._arity = arity
        this._zeroes = []
        this._nodes = []
        this._insertIndex = 0

        for (let level = 0; level < depth; level += 1) {
            this._zeroes.push(zeroValue)
            this._nodes[level] = new Map<number, IMTNode>()
            zeroValue = hash(Array(this._arity).fill(zeroValue))
        }

        this._rootZero = zeroValue
        this._nodes[depth] = new Map<number, IMTNode>([[0, zeroValue]])

        for (const leaf of leaves) {
            this.insert(leaf)
        }

        Object.freeze(this._zeroes)
        Object.freeze(this._nodes)
    }

    public get root(): IMTNode {
        return this._getNode(this.depth, 0)
    }

    public get depth(): number {
        return this._depth
    }

    /**
     * Returns explicitly stored leaves ordered by index. Implicit zero leaves
     * are omitted so that the sparse representation is not materialized.
     */
    public get leaves(): IMTNode[] {
        return Array.from(this._nodes[0].entries())
            .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
            .map(([, leaf]) => leaf)
    }

    public get zeroes(): IMTNode[] {
        return this._zeroes
    }

    public get arity(): number {
        return this._arity
    }

    public indexOf(leaf: IMTNode): number {
        assertNode(leaf, "leaf")

        if (leaf === this.zeroes[0]) {
            const leafIndexes = Array.from(this._nodes[0].keys()).sort((left, right) => left - right)
            let candidateIndex = 0

            for (const leafIndex of leafIndexes) {
                if (leafIndex !== candidateIndex) {
                    return candidateIndex
                }
                candidateIndex += 1
            }

            return candidateIndex < this._capacity ? candidateIndex : -1
        }

        for (const [index, node] of this._nodes[0].entries()) {
            if (node === leaf) {
                return index
            }
        }

        return -1
    }

    public insert(leaf: IMTNode) {
        assertNode(leaf, "leaf")

        if (this._insertIndex >= this._capacity) {
            throw new Error("The tree is full")
        }

        this.update(this._insertIndex, leaf)
        this._insertIndex += 1
    }

    public delete(index: number) {
        this.update(index, this.zeroes[0])
    }

    public update(index: number, newLeaf: IMTNode) {
        assertNumber(index, "index")
        assertNode(newLeaf, "newLeaf")

        if (!Number.isInteger(index) || index < 0 || index >= this._capacity) {
            throw new Error("The leaf does not exist in this tree")
        }

        if (newLeaf === this._getNode(0, index)) {
            return
        }

        let node = newLeaf
        let currentIndex = index

        for (let level = 0; level < this.depth; level += 1) {
            const position = currentIndex % this.arity
            const levelStartIndex = currentIndex - position
            const levelEndIndex = levelStartIndex + this.arity
            const children: IMTNode[] = []

            this._setNode(level, currentIndex, node)

            for (let childIndex = levelStartIndex; childIndex < levelEndIndex; childIndex += 1) {
                children.push(this._getNode(level, childIndex))
            }

            node = this._hash(children)
            currentIndex = Math.floor(currentIndex / this.arity)
        }

        this._setNode(this.depth, 0, node)
    }

    public createProof(index: number): IMTMerkleProof {
        assertNumber(index, "index")

        if (!Number.isInteger(index) || index < 0 || index >= this._capacity) {
            throw new Error("The leaf does not exist in this tree")
        }

        const siblings: IMTNode[][] = []
        const pathIndices: number[] = []
        const leafIndex = index

        for (let level = 0; level < this.depth; level += 1) {
            const position = index % this.arity
            const levelStartIndex = index - position
            const levelEndIndex = levelStartIndex + this.arity

            pathIndices[level] = position
            siblings[level] = []

            for (let siblingIndex = levelStartIndex; siblingIndex < levelEndIndex; siblingIndex += 1) {
                if (siblingIndex !== index) {
                    siblings[level].push(this._getNode(level, siblingIndex))
                }
            }

            index = Math.floor(index / this.arity)
        }

        return { root: this.root, leaf: this._getNode(0, leafIndex), pathIndices, siblings, leafIndex }
    }

    public verifyProof(proof: IMTMerkleProof): boolean {
        return TokamakSparseMerkleTree.verifyProof(proof, this._hash)
    }

    public static verifyProof(proof: IMTMerkleProof, hash: IMTHashFunction): boolean {
        assertObject(proof, "proof")
        assertNode(proof.root, "proof.root")
        assertNode(proof.leaf, "proof.leaf")
        assertArray(proof.siblings, "proof.siblings")
        assertArray(proof.pathIndices, "proof.pathIndices")

        let node = proof.leaf

        for (let level = 0; level < proof.siblings.length; level += 1) {
            const children = proof.siblings[level].slice()
            children.splice(proof.pathIndices[level], 0, node)
            node = hash(children)
        }

        return proof.root === node
    }

    private get _capacity(): number {
        return this.arity ** this.depth
    }

    private _getNode(level: number, index: number): IMTNode {
        return this._nodes[level].get(index) ?? this._zeroValueForLevel(level)
    }

    private _setNode(level: number, index: number, node: IMTNode): void {
        const zeroValue = this._zeroValueForLevel(level)

        if (node === zeroValue && level !== this.depth) {
            this._nodes[level].delete(index)
            return
        }

        this._nodes[level].set(index, node)
    }

    private _zeroValueForLevel(level: number): IMTNode {
        if (level === this.depth) {
            return this._rootZero
        }

        return this.zeroes[level]
    }
}

export class TokamakL2MerkleTrees {
    private _trees: Map<bigint, TokamakSparseMerkleTree>;

    constructor(addresses: Address[]) {
        this._trees = new Map<bigint, TokamakSparseMerkleTree>();
        addresses.forEach(addr => this._trees.set(
            bytesToBigInt(addr.bytes),
            new TokamakSparseMerkleTree(poseidon_raw as IMTHashFunction, MT_DEPTH, NULL_LEAF, POSEIDON_INPUTS)
        ));
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
