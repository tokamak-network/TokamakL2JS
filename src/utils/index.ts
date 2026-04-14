import { bigIntToBytes, concatBytes, setLengthLeft } from "@ethereumjs/util"

export function batchBigIntTo32BytesEach(...inVals: bigint[]): Uint8Array {
    return concatBytes(...inVals.map(x => setLengthLeft(bigIntToBytes(x), 32)))
}
