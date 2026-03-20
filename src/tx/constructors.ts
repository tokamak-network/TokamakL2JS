import { TxOptions } from "@ethereumjs/tx"
import { TokamakL2Tx } from "./TokamakL2Tx.js"
import { TokamakL2TxData } from "./types.js"
import { EthereumJSErrorWithoutCode, RLP } from "@ethereumjs/rlp"
import { Address, addHexPrefix, bytesToBigInt, hexToBytes } from "@ethereumjs/util"
import { ANY_LARGE_GAS_LIMIT, ANY_LARGE_GAS_PRICE, FUNCTION_INPUT_LENGTH } from "../interface/params/index.js"
import { TxSnapshot } from "../interface/channel/types.js"

const RAW_TX_FIELD_MAX_LENGTHS = {
  nonce: 32,
  to: 20,
  data: 4 + FUNCTION_INPUT_LENGTH * 32,
  senderPubKey: 32,
  v: 1,
  r: 32,
  s: 32,
} as const

function validateTxDataRawMaxLengths(txDataRaw: Record<keyof typeof RAW_TX_FIELD_MAX_LENGTHS, Uint8Array>) {
  for (const [field, maxLength] of Object.entries(RAW_TX_FIELD_MAX_LENGTHS)) {
    const value = txDataRaw[field as keyof typeof RAW_TX_FIELD_MAX_LENGTHS]
    if (value.length > maxLength) {
      throw EthereumJSErrorWithoutCode(
        `${field} exceeds maximum length ${maxLength}, received length ${value.length}`,
      )
    }
  }
}

export function createTokamakL2Tx(txData: TokamakL2TxData, opts: TxOptions): TokamakL2Tx {
    if (opts.common?.customCrypto === undefined) {
        throw new Error("Required 'common.customCrypto'")
    }
    // Set the minimum gasLimit to execute VM._runTx
    const gasLimit = txData.gasLimit ?? ANY_LARGE_GAS_LIMIT;
    const gasPrice = txData.gasPrice ?? ANY_LARGE_GAS_PRICE;
    const tx =  new TokamakL2Tx({...txData, gasLimit, gasPrice}, opts)
    tx.initUnsafeSenderPubKey(txData.senderPubKey)
    return tx
}

/**
 * Create a transaction from an array of byte encoded values ordered according to the devp2p network encoding - format noted below.
 *
 * Format: `[nonce, to, data, senderPubKey, v, r, s]`
 */
export function createTokamakL2TxFromBytesArray(values: Uint8Array[], opts: TxOptions): TokamakL2Tx {
  if ( values.length !== 7 ) {
    throw EthereumJSErrorWithoutCode(
      'Invalid transaction. Only expecting 7 values for signed tx.',
    )
  }

  const [nonce, to, data, senderPubKey, v, r, s] = values

  const txDataRaw = {nonce, to, data, senderPubKey, v, r, s}
  validateTxDataRawMaxLengths(txDataRaw)

  const txDataFormat: TokamakL2TxData = {
    nonce: bytesToBigInt(nonce),
    to: new Address(to),
    data,
    senderPubKey,
    v: v.length === 0 ? undefined : bytesToBigInt(v),
    r: r.length === 0 ? undefined : bytesToBigInt(r),
    s: s.length === 0 ? undefined : bytesToBigInt(s),
  }

  return createTokamakL2Tx(txDataFormat, opts)
}

export function createTokamakL2TxFromSnapshot(
  snapshot: TxSnapshot,
  opts: TxOptions,
): TokamakL2Tx {
  return createTokamakL2Tx(
    {
      nonce: BigInt(snapshot.nonce),
      to: new Address(hexToBytes(addHexPrefix(snapshot.to))),
      data: hexToBytes(addHexPrefix(snapshot.data)),
      senderPubKey: hexToBytes(addHexPrefix(snapshot.senderPubKey)),
      v: snapshot.v === undefined ? undefined : BigInt(snapshot.v),
      r: snapshot.r === undefined ? undefined : BigInt(snapshot.r),
      s: snapshot.s === undefined ? undefined : BigInt(snapshot.s),
    },
    opts,
  )
}

/**
 * Instantiate a transaction from a RLP serialized tx.
 *
 * Format: `rlp([nonce, to, data, senderPubKey, v, r, s])`
 */
export function createTokamakL2TxFromRLP(serialized: Uint8Array, opts: TxOptions): TokamakL2Tx {
  const values = RLP.decode(serialized)

  if (!Array.isArray(values)) {
    throw EthereumJSErrorWithoutCode('Invalid serialized tx input. Must be array')
  }

  return createTokamakL2TxFromBytesArray(values as Uint8Array[], opts)
}
