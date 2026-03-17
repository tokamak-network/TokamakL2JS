import { jubjub } from "@noble/curves/misc.js";
import { DST_NONCE } from "../interface/params/index.js";
import { bigIntToBytes, bytesToBigInt, concatBytes, setLengthLeft } from "@ethereumjs/util";
import { EdwardsPoint } from "@noble/curves/abstract/edwards.js";
import { batchBigIntTo32BytesEach } from "../utils/index.js";
import { poseidon2 } from "poseidon-bls12381"
// TODO: Import this constant from QAP compiler in the future, when QAP compiler is NPM-packaged.
import { POSEIDON_INPUTS } from "../interface/params/index.js";

export const poseidon_raw = (inVals: bigint[]): bigint => {
  if (inVals.length !== POSEIDON_INPUTS) {
    throw new Error(`Expected an array with ${POSEIDON_INPUTS} elements, but got ${inVals.length} elements`)
  }
  return poseidon2(inVals)
}

// To replace KECCAK256 with poseidon4. Example:
// const common = new Common({ chain: Mainnet, customCrypto: { keccak256: poseidon } })
// const block = createBlock({}, { common })
export function poseidon(msg: Uint8Array): Uint8Array {
    if (msg.length === 0 ) {
        return setLengthLeft(bigIntToBytes(poseidon_raw(Array<bigint>(POSEIDON_INPUTS).fill(0n))), 32)
    }
    // Split input bytes into 32-byte big-endian words → BigInt[] (no Node Buffer dependency)
    const words: bigint[] = Array.from({ length: Math.ceil(msg.byteLength / 32) }, (_, i) => {
      const slice = msg.subarray(i * 32, (i + 1) * 32)
      return bytesToBigInt(slice)
    });

    return setLengthLeft(
      bigIntToBytes(poseidonChainCompress(words.length === 1 ? [words[0], 0n] : words)),
      32,
    );
}

export function poseidonChainCompress(in_vals: bigint[]): bigint {
    if (in_vals.length < 2) {
    throw new Error(`Expected at least 2 values, but got ${in_vals.length}`);
  }

  let acc = poseidon_raw([in_vals[0], in_vals[1]]);
  for (let i = 2; i < in_vals.length; i++) {
    acc = poseidon_raw([acc, in_vals[i]]);
  }
  return acc;
}


// To replace ecrecover with Eddsa public key recovery. Example:
// const common = new Common({ chain: Mainnet, customCrypto: { ecrecover: getEddsaPublicKey } })
// const block = createBlock({}, { common })
export function getEddsaPublicKey(
    msgHash: Uint8Array,
    v: bigint,
    r: Uint8Array,
    s: Uint8Array,
    chainId?: bigint,
): Uint8Array {
    // msgHash must be the original message, not a hash.
    // The last 32 bytes of the msgHash contains the public key
    // v is useless but only to satisfy the interface of LegacyTx
    if (chainId !== undefined) {
        throw new Error("Eddsa does not require 'chainId' to recover a public key")
    }
    const msg = msgHash.subarray(0, msgHash.byteLength - 32)
    const pubKeyBytes = msgHash.subarray(msgHash.byteLength - 32, )

    const pubKey = jubjub.Point.fromBytes(pubKeyBytes)
    const randomizer = jubjub.Point.fromBytes(r)
    if (!eddsaVerify([msg], pubKey, randomizer, bytesToBigInt(s))) {
        throw new Error('Signature verification failed')
    }
    return pubKeyBytes
}

export function eddsaSign(prvKey: bigint, msg: Uint8Array[]): {R: EdwardsPoint, S: bigint} {
    const pubKey = jubjub.Point.BASE.multiply(prvKey)

    const nonceKeyBytes = poseidon(concatBytes(
            DST_NONCE,
            setLengthLeft(bigIntToBytes(prvKey), 32),
        ))

        const r = bytesToBigInt(poseidon(concatBytes(
            DST_NONCE,
            nonceKeyBytes,
            batchBigIntTo32BytesEach(
                pubKey.toAffine().x,
                pubKey.toAffine().y
            ),
            ...msg,
        ))) % jubjub.Point.Fn.ORDER

        const R = jubjub.Point.BASE.multiply(r)

        const e = bytesToBigInt(poseidon(concatBytes(
            batchBigIntTo32BytesEach(
                R.toAffine().x,
                R.toAffine().y,
                pubKey.toAffine().x,
                pubKey.toAffine().y
            ),
            ...msg
        )))
        const ep = e % jubjub.Point.Fn.ORDER

        const S = (r + ep * prvKey) % jubjub.Point.Fn.ORDER


    return {R, S}
}

export function eddsaVerify(msg: Uint8Array[], pubKey: EdwardsPoint, R: EdwardsPoint, S: bigint): boolean {
    if (S >= jubjub.Point.Fn.ORDER || S < 0n) return false
    if (pubKey.equals(jubjub.Point.ZERO)) return false
    if (R.equals(jubjub.Point.ZERO)) return false
    if (msg.length === 0) return false
    const e = bytesToBigInt(poseidon(concatBytes(
        batchBigIntTo32BytesEach(
            R.toAffine().x,
            R.toAffine().y,
            pubKey.toAffine().x,
            pubKey.toAffine().y
        ),
        ...msg
    ))) % jubjub.Point.Fn.ORDER
    const LHS = jubjub.Point.BASE.multiply(S)
    const RHS = pubKey.multiply(e).add(R)
    return LHS.equals(RHS)
}
