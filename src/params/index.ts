import { setLengthLeft, utf8ToBytes } from "@ethereumjs/util";

export const DST_NONCE = setLengthLeft(utf8ToBytes("TokamakAuth‑EDDSA‑NONCE‑v1"), 32);
export const ANY_LARGE_GAS_LIMIT = 9999999999999999n;
export const ANY_LARGE_GAS_PRICE = 9999999n;

// TODO: Modify QAP compiler to import the following constants from this pacakge.
export const POSEIDON_INPUTS = 2;
export const MT_DEPTH = 4;
export const MAX_MT_LEAVES = POSEIDON_INPUTS ** MT_DEPTH;