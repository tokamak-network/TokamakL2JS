import { IMTNode } from "@zk-kit/imt";
import { addHexPrefix, Address, createAccount, hexToBigInt } from "@ethereumjs/util";
import { createTokamakL2Common } from "../common/index.js";
import { RLP } from "@ethereumjs/rlp";

export const treeNodeToBigint = (node: IMTNode): bigint => {
    if (typeof node === "bigint") {
        return node;
    }
    if (typeof node === "string") {
        return hexToBigInt(addHexPrefix(node));
    }
    return BigInt(node);
};