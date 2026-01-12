import { BlockData, HeaderData } from "@ethereumjs/block";
import { TokamakL2TxData } from "../tx/types.js";

/**
 * A Tokamak L2 block's data.
 */
export interface TokamakL2BlockData extends BlockData {
    header: HeaderData
    transactions: Array<TokamakL2TxData>
}