// Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json>

import { promises as fs } from 'fs';
import { bigIntToHex, createAddressFromString } from '@ethereumjs/util';
import {
  createTokamakL2Common,
  createTokamakL2StateManagerFromStateSnapshot,
  type StateSnapshot,
} from '../../../src/index.ts';

const main = async () => {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) {
    throw new Error(
      'Snapshot file path is required. Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json>'
    );
  }

  const snapshot: StateSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));

  const stateManager = await createTokamakL2StateManagerFromStateSnapshot(snapshot, {
    common: createTokamakL2Common(),
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
