// Usage: npm run build && node --experimental-strip-types examples/stateManager/fromStateSnapshot/create-state-manager.ts <config.json> <snapshot.json>

import { promises as fs } from 'fs';
import { Common, Mainnet, Sepolia } from '@ethereumjs/common';
import { bigIntToHex, createAddressFromString } from '@ethereumjs/util';
import {
  createTokamakL2StateManagerFromStateSnapshot,
  getEddsaPublicKey,
  poseidon,
} from '../../../dist/index.js';

type ExampleSnapshotConfig = {
  network: 'mainnet' | 'sepolia';
  entryContractAddress: `0x${string}`;
  contractCodes: {
    address: `0x${string}`;
    code: `0x${string}`;
  }[];
};

type ExampleStateSnapshot = {
  channelId: number;
  stateRoots: string[];
  storageAddresses: string[];
  registeredKeys: { key: string; value: string }[][];
  entryContractAddress: string;
};

const getCommonForNetwork = (network: ExampleSnapshotConfig['network']): Common => {
  const chain = network === 'sepolia' ? Sepolia : Mainnet;
  return new Common({
    chain: {
      ...chain,
    },
    customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
  });
};

const main = async () => {
  const configPath = process.argv[2];
  const snapshotPath = process.argv[3];
  if (!configPath || !snapshotPath) {
    throw new Error(
      'Config and snapshot file paths are required. Usage: node --experimental-strip-types examples/stateManager/fromStateSnapshot/create-state-manager.ts <config.json> <snapshot.json>'
    );
  }

  const config: ExampleSnapshotConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const snapshot: ExampleStateSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));

  if (
    snapshot.entryContractAddress.toLowerCase() !==
    config.entryContractAddress.toLowerCase()
  ) {
    throw new Error('The snapshot entry contract address must match the example config.');
  }

  const stateManager = await createTokamakL2StateManagerFromStateSnapshot(snapshot, {
    common: getCommonForNetwork(config.network),
    entryContractAddress: createAddressFromString(config.entryContractAddress),
    storageAddresses: snapshot.storageAddresses.map((address) =>
      createAddressFromString(address)
    ),
    contractCodes: config.contractCodes.map((entry) => ({
      address: createAddressFromString(entry.address),
      code: entry.code,
    })),
  });

  const merkleTrees = await stateManager.getUpdatedMerkleTree();
  console.log('TokamakL2StateManager created from StateSnapshot.');
  console.log(`Merkle roots: ${merkleTrees.getRoots().map((root) => bigIntToHex(root))}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
