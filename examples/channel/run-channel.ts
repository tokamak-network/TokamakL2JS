// Usage: tsx examples/channel/run-channel.ts [inputStateSnapshot.json] [transactionConfig.json] [outputStateSnapshot.json]

import { promises as fs } from 'fs';
import { Common, Mainnet, Sepolia } from '@ethereumjs/common';
import { createVM, runTx } from '@ethereumjs/vm';
import {
  bytesToHex,
  concatBytes,
  createAccount,
  createAddressFromString,
  hexToBytes,
  setLengthLeft,
  utf8ToBytes,
} from '@ethereumjs/util';
import { jubjub } from '@noble/curves/misc.js';
import {
  createTokamakL2StateManagerFromStateSnapshot,
  createTokamakL2Tx,
  deriveL2KeysFromSignature,
  fromEdwardsToAddress,
  getEddsaPublicKey,
  poseidon,
  type StateSnapshot,
} from '../../src/index.ts';

type ChannelTransactionConfig = {
  network: 'mainnet' | 'sepolia';
  senderSeed: string;
  recipientSeed: string;
  txNonce: number;
  contractAddress: `0x${string}`;
  contractCode: `0x${string}`;
  transferSelector: `0x${string}`;
  amount: `0x${string}`;
};

const DEFAULT_INPUT_PATH = new URL('./inputStateSnapshot.json', import.meta.url);
const DEFAULT_TX_CONFIG_PATH = new URL('./transactionConfig.json', import.meta.url);
const DEFAULT_OUTPUT_PATH = new URL('./outputStateSnapshot.json', import.meta.url);
const FUNDED_SENDER_BALANCE = 10n ** 32n;

const getCommonForNetwork = (network: ChannelTransactionConfig['network']): Common => {
  const chain = network === 'sepolia' ? Sepolia : Mainnet;
  return new Common({
    chain: {
      ...chain,
    },
    customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
  });
};

const toSeedBytes = (seed: string) => setLengthLeft(utf8ToBytes(seed), 32);

const createSignatureFromSeed = (seed: string): `0x${string}` => {
  return bytesToHex(jubjub.utils.randomPrivateKey(toSeedBytes(seed)));
};

const main = async () => {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT_PATH;
  const transactionConfigPath = process.argv[3] ?? DEFAULT_TX_CONFIG_PATH;
  const outputPath = process.argv[4] ?? DEFAULT_OUTPUT_PATH;

  const inputSnapshot: StateSnapshot = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const transactionConfig: ChannelTransactionConfig = JSON.parse(
    await fs.readFile(transactionConfigPath, 'utf8')
  );

  if (
    inputSnapshot.entryContractAddress.toLowerCase() !==
    transactionConfig.contractAddress.toLowerCase()
  ) {
    throw new Error('The snapshot entry contract address must match the transaction config.');
  }

  const common = getCommonForNetwork(transactionConfig.network);
  const stateManager = await createTokamakL2StateManagerFromStateSnapshot(inputSnapshot, {
    common,
    entryContractAddress: createAddressFromString(inputSnapshot.entryContractAddress),
    storageAddresses: inputSnapshot.storageAddresses.map((address) =>
      createAddressFromString(address)
    ),
    contractCodes: [
      {
        address: createAddressFromString(transactionConfig.contractAddress),
        code: transactionConfig.contractCode,
      },
    ],
  });

  const senderKeys = deriveL2KeysFromSignature(
    createSignatureFromSeed(transactionConfig.senderSeed)
  );
  const recipientKeys = deriveL2KeysFromSignature(
    createSignatureFromSeed(transactionConfig.recipientSeed)
  );
  const senderAddress = fromEdwardsToAddress(senderKeys.publicKey);
  const recipientAddress = fromEdwardsToAddress(recipientKeys.publicKey);

  const tx = createTokamakL2Tx(
    {
      nonce: BigInt(transactionConfig.txNonce),
      to: createAddressFromString(transactionConfig.contractAddress),
      data: concatBytes(
        setLengthLeft(hexToBytes(transactionConfig.transferSelector), 4),
        setLengthLeft(recipientAddress.toBytes(), 32),
        setLengthLeft(hexToBytes(transactionConfig.amount), 32)
      ),
      senderPubKey: senderKeys.publicKey,
    },
    { common }
  ).sign(senderKeys.privateKey);

  await stateManager.putAccount(
    senderAddress,
    createAccount({ nonce: 0n, balance: FUNDED_SENDER_BALANCE })
  );

  const vm = await createVM({ common, stateManager });
  const txResult = await runTx(vm, { tx });
  if (txResult.execResult.exceptionError !== undefined) {
    throw txResult.execResult.exceptionError;
  }

  const outputSnapshot = await stateManager.captureStateSnapshot(inputSnapshot);
  await fs.writeFile(outputPath, `${JSON.stringify(outputSnapshot, null, 2)}\n`);

  console.log('TokamakL2StateManager created from inputStateSnapshot.json.');
  console.log(`Signed tx RLP: ${bytesToHex(tx.serialize())}`);
  console.log(`Updated snapshot written to ${outputPath.toString()}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
