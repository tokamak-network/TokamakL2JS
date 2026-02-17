#!/usr/bin/env node

import { Common, Mainnet } from '@ethereumjs/common'
import { bytesToHex, concatBytes, createAddressFromString, hexToBytes, setLengthLeft } from '@ethereumjs/util'
import {
  POSEIDON_INPUTS,
  createTokamakL2Tx,
  createTokamakL2TxFromRLP,
  deriveL2KeysFromSignature,
  fromEdwardsToAddress,
  getEddsaPublicKey,
  poseidon,
  poseidon_raw,
} from '../../../../dist/index.js'

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg)
  }
}

const senderSig = `0x${'11'.repeat(32)}`
const recipientSig = `0x${'22'.repeat(32)}`

const senderKeys = deriveL2KeysFromSignature(senderSig)
const recipientKeys = deriveL2KeysFromSignature(recipientSig)
const recipientAddress = fromEdwardsToAddress(recipientKeys.publicKey)

const callData = concatBytes(
  setLengthLeft(hexToBytes('0xa9059cbb'), 4),
  setLengthLeft(recipientAddress.bytes, 32),
  setLengthLeft(hexToBytes('0x2a'), 32),
)

const common = new Common({
  chain: { ...Mainnet },
  customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
})

const unsignedTx = createTokamakL2Tx(
  {
    nonce: 1n,
    to: createAddressFromString(`0x${'33'.repeat(20)}`),
    data: callData,
    senderPubKey: senderKeys.publicKey,
  },
  { common },
)

const signedTx = unsignedTx.sign(senderKeys.privateKey)
assert(signedTx.verifySignature(), 'Signed transaction must verify')

const expectedSender = fromEdwardsToAddress(senderKeys.publicKey).toString().toLowerCase()
const actualSender = signedTx.getSenderAddress().toString().toLowerCase()
assert(actualSender === expectedSender, `Sender address mismatch: expected=${expectedSender}, actual=${actualSender}`)

const serializedHex = bytesToHex(signedTx.serialize())
const roundTrip = createTokamakL2TxFromRLP(signedTx.serialize(), { common })
const roundTripHex = bytesToHex(roundTrip.serialize())
assert(roundTrip.verifySignature(), 'Round-trip transaction must verify')
assert(roundTripHex === serializedHex, 'RLP round-trip serialization mismatch')

let threwPoseidonArity = false
try {
  poseidon_raw(new Array(Number(POSEIDON_INPUTS) - 1).fill(1n))
} catch {
  threwPoseidonArity = true
}
assert(threwPoseidonArity, 'poseidon_raw must reject invalid arity')

const emptyDigest = poseidon(new Uint8Array(0))
assert(emptyDigest.length === 32, 'poseidon(empty) must return 32-byte digest')

console.log('tx-crypto smoke check passed')
console.log(`- tx serialized bytes: ${signedTx.serialize().length}`)
console.log(`- sender: ${actualSender}`)
