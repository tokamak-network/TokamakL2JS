import { setLengthLeft, utf8ToBytes } from "@ethereumjs/util";

// Params locally used
export const ANY_LARGE_GAS_LIMIT = 9999999999999999n;
export const ANY_LARGE_GAS_PRICE = 9999999n;

// Params to feed channel interface
export const DST_NONCE = setLengthLeft(utf8ToBytes("TokamakL2JS‑EDDSA‑NONCE‑v1"), 32);
export const MT_LEAF_PREFIX = setLengthLeft(utf8ToBytes("TokamakL2JS-Merkle-Tree‑v1"), 32);

// Params to feed QAP Compiler 
export const POSEIDON_INPUTS = 2;
export const MT_DEPTH = 4;
export const MAX_MT_LEAVES = POSEIDON_INPUTS ** MT_DEPTH;