import { jubjub } from "@noble/curves/misc.js";
import { setLengthLeft, utf8ToBytes } from "@ethereumjs/util";
import { batchBigIntTo32BytesEach } from "../../utils/index.js";

// Params locally used
export const ANY_LARGE_GAS_LIMIT = 9999999999999999n;
export const ANY_LARGE_GAS_PRICE = 9999999n;
export const NULL_STORAGE_KEY = jubjub.Point.Fp.ORDER - 1n;
export const NULL_LEAF = batchBigIntTo32BytesEach(NULL_STORAGE_KEY, 0n);

// Params to feed channel interface
export const DST_NONCE = setLengthLeft(utf8ToBytes("TokamakAuth‑EDDSA‑NONCE‑v1"), 32);

// Params to feed QAP Compiler 
export const POSEIDON_INPUTS = 2;
export const MT_DEPTH = 20;
export const MAX_MT_LEAVES = POSEIDON_INPUTS ** MT_DEPTH;
