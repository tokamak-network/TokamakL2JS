// Usage: tsx examples/create-tx.ts <config.json>

import { promises as fs } from 'fs';
import {
  bytesToHex,
  createAddressFromString,
  hexToBytes,
  setLengthLeft,
  utf8ToBytes,
} from '@ethereumjs/util';
import { jubjub } from '@noble/curves/misc.js';
import {
  createTokamakL2Common,
  createTokamakL2Tx,
  deriveL2KeysFromSignature,
  TokamakL2TxData,
} from '../../src/index.js';

type TxConfig = {
  senderSeed: string;
  txNonce: bigint;
  calldata: `0x${string}`;
  function: {
    selector: `0x${string}`;
    entryContractAddress: `0x${string}`;
  };
};

const toSeedBytes = (seed: string) => setLengthLeft(utf8ToBytes(seed), 32);
const hasSelectorPrefix = (calldata: `0x${string}`, selector: `0x${string}`) =>
  calldata.toLowerCase().startsWith(selector.toLowerCase());

const main = async () => {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('Config file path required. Usage: tsx examples/create-tx.ts <config.json>');
  }

  const config: TxConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (!hasSelectorPrefix(config.calldata, config.function.selector)) {
    throw new Error('config.calldata must start with config.function.selector');
  }

  const senderSignature = bytesToHex(jubjub.utils.randomPrivateKey(toSeedBytes(config.senderSeed)));
  const senderKeys = deriveL2KeysFromSignature(senderSignature);

  const common = createTokamakL2Common();

  const txData: TokamakL2TxData = {
    nonce: config.txNonce,
    to: createAddressFromString(config.function.entryContractAddress),
    data: hexToBytes(config.calldata),
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
