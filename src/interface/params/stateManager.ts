import { jubjub } from "@noble/curves/misc.js";
import { poseidon_raw } from "../../crypto/index.js";
import { POSEIDON_INPUTS } from "./crypto.js";

// Params locally used
export const NULL_STORAGE_KEY = jubjub.Point.Fp.ORDER - 1n;
export const NULL_LEAF = poseidon_raw([NULL_STORAGE_KEY, 0n]);

// Params to feed QAP Compiler 
export const MT_DEPTH = 12;
export const MAX_MT_LEAVES = POSEIDON_INPUTS ** MT_DEPTH;
