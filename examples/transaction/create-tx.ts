// Usage: tsx examples/create-tx.ts <config.json>

import { promises as fs } from 'fs';
import { Common, CommonOpts, Mainnet } from '@ethereumjs/common';
import {
  bytesToHex,
  concatBytes,
  createAddressFromString,
  hexToBytes,
  setLengthLeft,
  utf8ToBytes,
} from '@ethereumjs/util';
import { jubjub } from '@noble/curves/misc.js';
import {
  createTokamakL2Tx,
  deriveL2KeysFromSignature,
  fromEdwardsToAddress,
  getEddsaPublicKey,
  poseidon,
  TokamakL2TxData,
} from '../../src/index.js';

type TxConfig = {
  senderSeed: string;
  recipientSeed: string;
  txNonce: bigint;
  contractAddress: `0x${string}`;
  transferSelector: `0x${string}`;
  amount: `0x${string}`;
};

const toSeedBytes = (seed: string) => setLengthLeft(utf8ToBytes(seed), 32);

const main = async () => {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('Config file path required. Usage: tsx examples/create-tx.ts <config.json>');
  }

  const config: TxConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));

  const senderSignature = bytesToHex(jubjub.utils.randomPrivateKey(toSeedBytes(config.senderSeed)));
  const recipientSignature = bytesToHex(jubjub.utils.randomPrivateKey(toSeedBytes(config.recipientSeed)));

  const senderKeys = deriveL2KeysFromSignature(senderSignature);
  const recipientKeys = deriveL2KeysFromSignature(recipientSignature);

  const recipientAddress = fromEdwardsToAddress(recipientKeys.publicKey);
  const callData = concatBytes(
    setLengthLeft(hexToBytes(config.transferSelector), 4),
    setLengthLeft(recipientAddress.toBytes(), 32),
    setLengthLeft(hexToBytes(config.amount), 32)
  );

  const commonOpts: CommonOpts = {
    chain: {
      ...Mainnet,
    },
    customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
  };
  const common = new Common(commonOpts);

  const txData: TokamakL2TxData = {
    nonce: config.txNonce,
    to: createAddressFromString(config.contractAddress),
    data: callData,
    senderPubKey: senderKeys.publicKey,
  };

  const unsignedTx = createTokamakL2Tx(txData, { common });
  const signedTx = unsignedTx.sign(senderKeys.privateKey);

  console.log(`Signed tx RLP: ${bytesToHex(signedTx.serialize())}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
