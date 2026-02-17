#!/usr/bin/env node

import { bytesToBigInt, bytesToHex } from '@ethereumjs/util'
import { jubjub } from '@noble/curves/misc.js'
import {
  POSEIDON_INPUTS,
  deriveL2KeysFromSignature,
  eddsaSign,
  eddsaVerify,
  poseidon,
  poseidon_raw,
} from '../../../../dist/index.js'

const EXPECTED_PRIVATE_KEY = '0x0238972b55410d3831288cfe38093e8457adf0833f9cc6b7f80412859b3106e0'
const EXPECTED_PUBLIC_KEY = '0x4973750aaa85b6007a858b1547881b91bcb204a5287a9e105ee6e5fc4db969bd'
const EXPECTED_POSEIDON_RAW_1_2 = '0x3fb8310b0e962b75bffec5f9cfcbf3f965a7b1d2dcac8d95ccb13d434e08e5fa'
const EXPECTED_POSEIDON_EMPTY = '0x720772992425c4618eaf8a7ff4b6ad5333a76fe17dd3624e2329a57dfaaa505e'
const EXPECTED_R = '0x6c4504edcf8af67cdfb71e4c86e5264444f3466b3834684f1f084b399465dba9'
const EXPECTED_S = '0x09b46e1a8aa67100e9acbb1681ca643528e6e110ac954e9a981dc19c6cdc001b'

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const fixedSignature = `0x${'11'.repeat(32)}`
const keys = deriveL2KeysFromSignature(fixedSignature)
const actualPrivateKey = bytesToHex(keys.privateKey)
const actualPublicKey = bytesToHex(keys.publicKey)

assert(actualPrivateKey === EXPECTED_PRIVATE_KEY, 'Derived private key vector mismatch')
assert(actualPublicKey === EXPECTED_PUBLIC_KEY, 'Derived public key vector mismatch')

const rawHash = `0x${poseidon_raw([1n, 2n]).toString(16)}`
assert(rawHash === EXPECTED_POSEIDON_RAW_1_2, 'poseidon_raw([1,2]) vector mismatch')

const emptyHash = bytesToHex(poseidon(new Uint8Array(0)))
assert(emptyHash === EXPECTED_POSEIDON_EMPTY, 'poseidon(empty) vector mismatch')

const msg = [new Uint8Array([0x01, 0x02, 0x03, 0x04])]
const sig = eddsaSign(bytesToBigInt(keys.privateKey), msg)
const actualR = bytesToHex(sig.R.toBytes())
const actualS = `0x${sig.S.toString(16).padStart(64, '0')}`

assert(actualR === EXPECTED_R, 'EDDSA R vector mismatch')
assert(actualS === EXPECTED_S, 'EDDSA S vector mismatch')

const pubKeyPoint = jubjub.Point.fromBytes(keys.publicKey)
assert(eddsaVerify(msg, pubKeyPoint, sig.R, sig.S), 'EDDSA verify should succeed for fixed vector')
assert(!eddsaVerify([new Uint8Array([0x01, 0x02, 0x03, 0x05])], pubKeyPoint, sig.R, sig.S), 'EDDSA verify should fail for mutated message')

let arityRejected = false
try {
  poseidon_raw(new Array(Number(POSEIDON_INPUTS) - 1).fill(1n))
} catch {
  arityRejected = true
}
assert(arityRejected, 'poseidon_raw must reject invalid arity')

console.log('crypto smoke check passed')
console.log(`- derived public key: ${actualPublicKey}`)
console.log(`- poseidon_raw([1,2]): ${rawHash}`)
