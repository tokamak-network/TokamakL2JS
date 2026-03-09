// Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json>

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
  entryContractAddress: string;
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
  if (!snapshotPath) {
    throw new Error(
      'Snapshot file path is required. Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json>'
    );
  }

  const snapshot: ExampleStateSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));

  const stateManager = await createTokamakL2StateManagerFromStateSnapshot(snapshot, {
    common: createExampleCommon(),
    entryContractAddress: createAddressFromString(snapshot.entryContractAddress),
    storageAddresses: snapshot.storageAddresses.map((address) =>
      createAddressFromString(address)
    ),
  });

  const merkleTrees = await stateManager.getUpdatedMerkleTree();
  console.log('TokamakL2StateManager created from StateSnapshot.');
  console.log(`Merkle roots: ${merkleTrees.getRoots().map((root) => bigIntToHex(root))}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
