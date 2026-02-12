import { IMTNode } from "@zk-kit/imt";
import { addHexPrefix, hexToBigInt } from "@ethereumjs/util";

export const treeNodeToBigint = (node: IMTNode): bigint => {
    if (typeof node === "bigint") {
        return node;
    }
    if (typeof node === "string") {
        return hexToBigInt(addHexPrefix(node));
    }
    return BigInt(node);
};
