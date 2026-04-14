import { Address } from "@ethereumjs/util";
import { EdwardsPoint } from "@noble/curves/abstract/edwards.js";
import { jubjub } from "@noble/curves/misc.js";
import { batchBigIntTo32BytesEach } from "../utils/index.js";
import { poseidon } from "./index.js";

export function fromEdwardsToAddress(point: EdwardsPoint | Uint8Array): Address {
    const edwardsToAffineBytes = (point: EdwardsPoint): Uint8Array => {
        const affine = point.toAffine()
        return batchBigIntTo32BytesEach(affine.x, affine.y)
    }
    let pointBytes: Uint8Array
    if (point instanceof Uint8Array) {
        if (point.length === 32) {
            pointBytes = edwardsToAffineBytes(jubjub.Point.fromBytes(point))
        } else if (point.length === 64) {
            pointBytes = point
        } else {
            throw new Error('Invalid EdwardsPoint format')
        }
    } else {
        pointBytes = edwardsToAffineBytes(point)
    }
    const addressByte = poseidon(pointBytes).subarray(-20)
    return new Address(addressByte)
}
