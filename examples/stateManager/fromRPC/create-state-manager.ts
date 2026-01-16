// Usage: tsx examples/create-state-manager.ts <config.json>

import { promises as fs } from 'fs';
import { Common, CommonOpts, Mainnet } from '@ethereumjs/common';
import {
  bytesToHex,
  createAddressFromString,
  hexToBytes,
  setLengthLeft,
  utf8ToBytes,
} from '@ethereumjs/util';
import { jubjub } from '@noble/curves/misc.js';
import {
  createTokamakL2StateManagerFromL1RPC,
  deriveL2KeysFromSignature,
  fromEdwardsToAddress,
  getEddsaPublicKey,
  getUserStorageKey,
  poseidon,
  TokamakL2StateManagerOpts,
} from '../../../src/index.js';
import { getRpcUrlFromEnv } from './utils.js';

const RPC_URL_ENV_KEY = 'RPC_URL';

type ParticipantEntry = {
  addressL1: `0x${string}`;
  prvSeedL2: string;
};

type StateManagerConfig = {
  participants: ParticipantEntry[];
  userStorageSlots: number[];
  preAllocatedKeys: `0x${string}`[];
  blockNumber: number;
  contractAddress: `0x${string}`;
  callCodeAddresses: `0x${string}`[];
};

const toSeedBytes = (seed: string) => setLengthLeft(utf8ToBytes(seed), 32);

const main = async () => {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('Config file path required. Usage: tsx examples/create-state-manager.ts <config.json>');
  }

  const config: StateManagerConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const rpcUrl = getRpcUrlFromEnv(RPC_URL_ENV_KEY);

  const privateSignatures = config.participants.map((entry) =>
    bytesToHex(jubjub.utils.randomPrivateKey(toSeedBytes(entry.prvSeedL2)))
  );

  const derivedPublicKeyListL2 = privateSignatures.map((sig) => {
    const keySet = deriveL2KeysFromSignature(sig);
    return jubjub.Point.fromBytes(keySet.publicKey);
  });

  const initStorageKeys = config.preAllocatedKeys.map((storageKey) => ({
    L1: setLengthLeft(hexToBytes(storageKey), 32),
    L2: setLengthLeft(hexToBytes(storageKey), 32),
  }));

  for (const slot of config.userStorageSlots) {
    for (let userIdx = 0; userIdx < config.participants.length; userIdx++) {
      const participant = config.participants[userIdx];
      const L1key = getUserStorageKey([participant.addressL1, slot], 'L1');
      const L2key = getUserStorageKey([fromEdwardsToAddress(derivedPublicKeyListL2[userIdx]), slot], 'TokamakL2');
      initStorageKeys.push({
        L1: L1key,
        L2: L2key,
      });
    }
  }

  const commonOpts: CommonOpts = {
    chain: {
      ...Mainnet,
    },
    customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
  };
  const common = new Common(commonOpts);

  const stateManagerOpts: TokamakL2StateManagerOpts = {
    common,
    blockNumber: config.blockNumber,
    contractAddress: createAddressFromString(config.contractAddress),
    initStorageKeys,
    callCodeAddresses: config.callCodeAddresses.map(str => createAddressFromString(str)),
  };

  const stateManager = await createTokamakL2StateManagerFromL1RPC(rpcUrl, stateManagerOpts);
  console.log('TokamakL2StateManager created.');
  console.log(`Merkle root: ${String(stateManager.initialMerkleTree.root)}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
