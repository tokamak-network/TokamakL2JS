import { Block, BlockData, BlockOptions, createBlockHeader, HeaderData } from "@ethereumjs/block";
import { createTx, TxOptions } from "@ethereumjs/tx";
import { TokamakL2TxData } from "../tx/types.js"
import { createTokamakL2Tx } from "../tx/constructors.js";
import { TRANSACTIONS_PER_BLOCK } from "../params/index.js";
import { TokamakL2Tx } from "../tx/TokamakL2Tx.js";
import { TokamakL2BlockData } from "./types.js";


export function createTokamakL2Block(blockData: TokamakL2BlockData, opts?: BlockOptions) {
    const {
        header: headerData,
        transactions: txsData,
    } = blockData;

    if (opts.common?.customCrypto === undefined) {
        throw new Error("Required 'common.customCrypto'")
    }

    const header = createBlockHeader(headerData, opts);

    if (txsData.length !== TRANSACTIONS_PER_BLOCK) {
        throw new Error(`A Tokamak L2 block must exactly contain ${TRANSACTIONS_PER_BLOCK} transactions, but got ${txsData.length}`)
    }

    // parse transactions
    const transactions: TokamakL2Tx[] = [];
    for (const txData of txsData) {
        const tx = createTokamakL2Tx(txData, {
            ...opts,
            // Use header common in case of setHardfork being activated
            common: header.common,
        });
        transactions.push(tx)
    }

    return new Block(header, transactions, [], undefined, opts)
}