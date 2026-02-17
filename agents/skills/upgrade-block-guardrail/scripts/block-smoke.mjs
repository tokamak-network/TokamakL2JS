#!/usr/bin/env node

import { Common, Mainnet } from '@ethereumjs/common'
import { bytesToHex, concatBytes, createAddressFromString, hexToBytes, setLengthLeft } from '@ethereumjs/util'
import {
  createTokamakL2Block,
  deriveL2KeysFromSignature,
  fromEdwardsToAddress,
  getEddsaPublicKey,
  poseidon,
} from '../../../../dist/index.js'

const EXPECTED_HASH = '0x50e738df075573f99d0d90be6da84e6f7b70871b9359b1988260011ef775f765'

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
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

let missingCryptoRejected = false
try {
  createTokamakL2Block(
    {
      header: { gasLimit: 1000000n, number: 1n, timestamp: 1n },
      transactions: [
        {
          nonce: 1n,
          to: createAddressFromString(`0x${'33'.repeat(20)}`),
          data: callData,
          senderPubKey: senderKeys.publicKey,
        },
      ],
    },
    {},
  )
} catch {
  missingCryptoRejected = true
}
assert(missingCryptoRejected, 'Block constructor must reject missing common.customCrypto')

const common = new Common({
  chain: { ...Mainnet },
  customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
})

const block = createTokamakL2Block(
  {
    header: { gasLimit: 1000000n, number: 1n, timestamp: 1n },
    transactions: [
      {
        nonce: 1n,
        to: createAddressFromString(`0x${'33'.repeat(20)}`),
        data: callData,
        senderPubKey: senderKeys.publicKey,
      },
    ],
  },
  { common },
)

assert(block.transactions.length === 1, 'Block tx count mismatch')
assert(block.transactions[0].gasLimit === block.header.gasLimit, 'Tx gasLimit must match header gasLimit')

const blockHash = bytesToHex(block.hash())
assert(blockHash === EXPECTED_HASH, 'Block hash vector changed')

console.log('block smoke check passed')
console.log(`- txCount: ${block.transactions.length}`)
console.log(`- blockHash: ${blockHash}`)
