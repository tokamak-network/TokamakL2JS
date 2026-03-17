// Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json> <entry-contract-address>

import { promises as fs } from 'fs';
import { Common, Mainnet } from '@ethereumjs/common';
import { bigIntToHex, createAddressFromString } from '@ethereumjs/util';
import {
  createTokamakL2StateManagerFromStateSnapshot,
  getEddsaPublicKey,
  poseidon,
} from '../../../src/index.ts';

type ExampleStateSnapshot = {
  channelId: number;
  stateRoots: string[];
  storageAddresses: string[];
  registeredKeys: { key: string; value: string }[][];
};

const createExampleCommon = (): Common => {
  return new Common({
    chain: {
      ...Mainnet,
    },
    customCrypto: { keccak256: poseidon, ecrecover: getEddsaPublicKey },
  });
};

const main = async () => {
  const snapshotPath = process.argv[2];
  const entryContractAddress = process.argv[3];
  if (!snapshotPath) {
    throw new Error(
      'Snapshot file path is required. Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json> <entry-contract-address>'
    );
  }
  if (!entryContractAddress) {
    throw new Error(
      'Entry contract address is required. Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json> <entry-contract-address>'
    );
  }

  const snapshot: ExampleStateSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));

  const stateManager = await createTokamakL2StateManagerFromStateSnapshot(snapshot, {
    common: createExampleCommon(),
    entryContractAddress: createAddressFromString(entryContractAddress),
    storageAddresses: snapshot.storageAddresses.map((address) =>
      createAddressFromString(address)
    ),
  });

  const merkleTrees = stateManager.lastMerkleTrees;
  console.log('TokamakL2StateManager created from StateSnapshot.');
  console.log(`Merkle roots: ${merkleTrees.getRoots().map((root) => bigIntToHex(root))}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
