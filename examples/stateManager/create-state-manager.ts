// Usage: tsx examples/create-state-manager.ts <config.json>

import { promises as fs } from 'fs';
import { Common, CommonOpts, Mainnet } from '@ethereumjs/common';
import {
  assertNumberArray,
  assertStringArray,
  getRpcUrlFromEnv,
  parseHexString,
  parseNumberValue,
} from '../utility/parse.js';
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
} from '../../src/index.js';

const RPC_URL_ENV_KEY = 'RPC_URL';

type StateManagerConfig = {
  privateKeySeedsL2: string[];
  addressListL1: `0x${string}`[];
  userStorageSlots: number[];
  initStorageKey: `0x${string}`;
  blockNumber: number;
  contractAddress: `0x${string}`;
};

const loadConfig = async (configPath: string): Promise<StateManagerConfig> => {
  const configRaw = JSON.parse(await fs.readFile(configPath, 'utf8'));

  const privateKeySeedsL2 = assertStringArray(configRaw.privateKeySeedsL2, 'privateKeySeedsL2');
  const addressListL1 = assertStringArray(configRaw.addressListL1, 'addressListL1').map((address) => {
    if (!address.startsWith('0x')) {
      throw new Error('addressListL1 entries must be hex strings with 0x prefix');
    }
    return address as `0x${string}`;
  });

  if (privateKeySeedsL2.length !== addressListL1.length) {
    throw new Error('privateKeySeedsL2 and addressListL1 must have the same length');
  }

  return {
    privateKeySeedsL2,
    addressListL1,
    userStorageSlots: assertNumberArray(configRaw.userStorageSlots, 'userStorageSlots'),
    initStorageKey: parseHexString(configRaw.initStorageKey, 'initStorageKey'),
    blockNumber: parseNumberValue(configRaw.blockNumber, 'blockNumber'),
    contractAddress: parseHexString(configRaw.contractAddress, 'contractAddress'),
  };
};

const toSeedBytes = (seed: string) => setLengthLeft(utf8ToBytes(seed), 32);

const main = async () => {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('Config file path required. Usage: tsx examples/create-state-manager.ts <config.json>');
  }

  const config = await loadConfig(configPath);
  const rpcUrl = getRpcUrlFromEnv(RPC_URL_ENV_KEY);

  const privateSignatures = config.privateKeySeedsL2.map((seed) =>
    bytesToHex(jubjub.utils.randomPrivateKey(toSeedBytes(seed)))
  );

  const derivedPublicKeyListL2 = privateSignatures.map((sig) => {
    const keySet = deriveL2KeysFromSignature(sig);
    return jubjub.Point.fromBytes(keySet.publicKey);
  });

  const initStorageKeys = [
    {
      L1: setLengthLeft(hexToBytes(config.initStorageKey), 32),
      L2: setLengthLeft(hexToBytes(config.initStorageKey), 32),
    },
  ];

  for (const slot of config.userStorageSlots) {
    for (let userIdx = 0; userIdx < config.addressListL1.length; userIdx++) {
      const l1Key = getUserStorageKey([config.addressListL1[userIdx], slot], 'L1');
      const l2Key = getUserStorageKey(
        [fromEdwardsToAddress(derivedPublicKeyListL2[userIdx]), slot],
        'TokamakL2'
      );
      initStorageKeys.push({
        L1: l1Key,
        L2: l2Key,
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
  };

  const stateManager = await createTokamakL2StateManagerFromL1RPC(rpcUrl, stateManagerOpts);
  console.log('TokamakL2StateManager created.');
  console.log(`Merkle root: ${String(stateManager.getMerkleTree(stateManager.lastMerkleTreeIndex).root)}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
