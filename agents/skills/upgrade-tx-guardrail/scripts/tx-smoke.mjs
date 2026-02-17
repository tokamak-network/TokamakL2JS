#!/usr/bin/env node

import { Common, Mainnet } from '@ethereumjs/common'
import { bytesToHex, concatBytes, createAddressFromString, hexToBytes, setLengthLeft } from '@ethereumjs/util'
import {
  createTokamakL2Tx,
  createTokamakL2TxFromRLP,
  deriveL2KeysFromSignature,
  fromEdwardsToAddress,
  getEddsaPublicKey,
  poseidon,
} from '../../../../dist/index.js'

const EXPECTED_SERIALIZED_HEX = '0xf8c001943333333333333333333333333333333333333333b844a9059cbb000000000000000000000000e531179ef748fe9fc10b699cbbece0c35f21f5ee000000000000000000000000000000000000000000000000000000000000002aa04973750aaa85b6007a858b1547881b91bcb204a5287a9e105ee6e5fc4db969bd1ba07e4680c83b0c27f47cd6895f4c42e69b811432ea9356b9f570a27fa7d1be6d9ca00bb3a60cec01fc54017a2fea359280e3ccd8b93744a632e5f8a0547a5c6cdca7'
const EXPECTED_SENDER = '0x52efcf7f3f0d914d586e60ed51117f908b9e16ba'

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

const actualSender = signedTx.getSenderAddress().toString().toLowerCase()
assert(actualSender === EXPECTED_SENDER, `Sender address mismatch: expected=${EXPECTED_SENDER}, actual=${actualSender}`)

const serializedHex = bytesToHex(signedTx.serialize())
assert(serializedHex === EXPECTED_SERIALIZED_HEX, 'Serialized tx vector changed')

const roundTrip = createTokamakL2TxFromRLP(signedTx.serialize(), { common })
const roundTripHex = bytesToHex(roundTrip.serialize())
assert(roundTrip.verifySignature(), 'Round-trip transaction must verify')
assert(roundTripHex === serializedHex, 'RLP round-trip serialization mismatch')

console.log('tx smoke check passed')
console.log(`- serialized bytes: ${signedTx.serialize().length}`)
console.log(`- sender: ${actualSender}`)
