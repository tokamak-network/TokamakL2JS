// Usage: tsx examples/channel/run-channel.ts [inputStateSnapshot.json] [transactionConfig.json] [blockInfo.json] [contractCode.json] [outputStateSnapshot.json]

import { promises as fs } from 'fs';
import { Common, Mainnet, Sepolia } from '@ethereumjs/common';
import { createBlock } from '@ethereumjs/block';
import { createVM, runTx } from '@ethereumjs/vm';
import {
  addHexPrefix,
  bytesToHex,
  concatBytes,
  createAddressFromString,
  hexToBigInt,
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
  getUserStorageKey,
  poseidon,
  type StateSnapshot,
} from '../../src/index.ts';

type ChannelTransactionConfig = {
  network: 'mainnet' | 'sepolia';
  senderSeed: string;
  recipientSeed: string;
  userStorageSlot: number;
  txNonce: number;
  contractAddress: `0x${string}`;
  transferSelector: `0x${string}`;
  amount: `0x${string}`;
};

type ChannelBlockInfo = {
  number: `0x${string}`;
  gasLimit: `0x${string}`;
  timestamp: `0x${string}`;
};

type ChannelContractCode = {
  address: `0x${string}`;
  code: `0x${string}`;
};

const DEFAULT_INPUT_PATH = new URL('./inputStateSnapshot.json', import.meta.url);
const DEFAULT_TX_CONFIG_PATH = new URL('./transactionConfig.json', import.meta.url);
const DEFAULT_BLOCK_INFO_PATH = new URL('./blockInfo.json', import.meta.url);
const DEFAULT_CONTRACT_CODE_PATH = new URL('./contractCode.json', import.meta.url);
const DEFAULT_OUTPUT_PATH = new URL('./outputStateSnapshot.json', import.meta.url);

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

const parseHexBigInt = (value: `0x${string}`): bigint => hexToBigInt(addHexPrefix(value));

const main = async () => {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT_PATH;
  const transactionConfigPath = process.argv[3] ?? DEFAULT_TX_CONFIG_PATH;
  const blockInfoPath = process.argv[4] ?? DEFAULT_BLOCK_INFO_PATH;
  const contractCodePath = process.argv[5] ?? DEFAULT_CONTRACT_CODE_PATH;
  const outputPath = process.argv[6] ?? DEFAULT_OUTPUT_PATH;

  const inputSnapshot: StateSnapshot = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const transactionConfig: ChannelTransactionConfig = JSON.parse(
    await fs.readFile(transactionConfigPath, 'utf8')
  );
  const blockInfo: ChannelBlockInfo = JSON.parse(await fs.readFile(blockInfoPath, 'utf8'));
  const contractCodes: ChannelContractCode[] = JSON.parse(
    await fs.readFile(contractCodePath, 'utf8')
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
    contractCodes: contractCodes.map((entry) => ({
      address: createAddressFromString(entry.address),
      code: entry.code,
    })),
  });

  const senderKeys = deriveL2KeysFromSignature(
    createSignatureFromSeed(transactionConfig.senderSeed)
  );
  const recipientKeys = deriveL2KeysFromSignature(
    createSignatureFromSeed(transactionConfig.recipientSeed)
  );
  const senderAddress = fromEdwardsToAddress(senderKeys.publicKey);
  const recipientAddress = fromEdwardsToAddress(recipientKeys.publicKey);
  const senderStorageKey = getUserStorageKey(
    [senderAddress, transactionConfig.userStorageSlot],
    'TokamakL2'
  );
  const recipientStorageKey = getUserStorageKey(
    [recipientAddress, transactionConfig.userStorageSlot],
    'TokamakL2'
  );
  const registeredKeysForContract =
    inputSnapshot.registeredKeys[
      inputSnapshot.storageAddresses.findIndex(
        (address) =>
          address.toLowerCase() === transactionConfig.contractAddress.toLowerCase()
      )
    ] ?? [];
  const registeredKeySet = new Set(
    registeredKeysForContract.map((entry) => entry.key.toLowerCase())
  );
  for (const requiredKey of [bytesToHex(senderStorageKey), bytesToHex(recipientStorageKey)]) {
    if (!registeredKeySet.has(requiredKey.toLowerCase())) {
      throw new Error(
        `The input snapshot does not register the storage key required by the transaction: ${requiredKey}`
      );
    }
  }

  const tx = createTokamakL2Tx(
    {
      nonce: BigInt(transactionConfig.txNonce),
      to: createAddressFromString(transactionConfig.contractAddress),
      data: concatBytes(
        setLengthLeft(hexToBytes(transactionConfig.transferSelector), 4),
        senderStorageKey,
        recipientStorageKey,
        setLengthLeft(hexToBytes(transactionConfig.amount), 32)
      ),
      senderPubKey: senderKeys.publicKey,
    },
    { common }
  ).sign(senderKeys.privateKey);

  const block = createBlock(
    {
      header: {
        number: parseHexBigInt(blockInfo.number),
        gasLimit: parseHexBigInt(blockInfo.gasLimit),
        timestamp: parseHexBigInt(blockInfo.timestamp),
      },
    },
    { common, skipConsensusFormatValidation: true }
  );
  const vm = await createVM({ common, stateManager });
  const txResult = await runTx(vm, {
    block,
    tx,
    skipBalance: true,
    skipBlockGasLimitValidation: true,
    skipHardForkValidation: true,
    reportPreimages: true,
  });
  if (txResult.execResult.exceptionError !== undefined) {
    throw txResult.execResult.exceptionError;
  }

  const outputSnapshot = await stateManager.captureStateSnapshot(inputSnapshot);
  await fs.writeFile(outputPath, `${JSON.stringify(outputSnapshot, null, 2)}\n`);

  console.log('TokamakL2StateManager created from inputStateSnapshot.json.');
  console.log(`Signed tx RLP: ${bytesToHex(tx.serialize())}`);
  console.log(`Sender address: ${senderAddress.toString()} (${bytesToHex(senderStorageKey)})`);
  console.log(`Recipient address: ${recipientAddress.toString()} (${bytesToHex(recipientStorageKey)})`);
  console.log(`Updated snapshot written to ${outputPath.toString()}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
