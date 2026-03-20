import { setLengthLeft, utf8ToBytes } from "@ethereumjs/util";

// Params to feed channel interface
export const DST_NONCE = setLengthLeft(utf8ToBytes("TokamakAuth‑EDDSA‑NONCE‑v1"), 32);

// Params to feed QAP Compiler 
export const POSEIDON_INPUTS = 2;
