// Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json> <contract-code.json>

import { promises as fs } from 'fs';
import { bigIntToHex, createAddressFromString } from '@ethereumjs/util';
import {
  createTokamakL2StateManagerFromStateSnapshot,
  type StateSnapshot,
} from '../../../src/index.ts';

type ContractCode = {
  address: `0x${string}`;
  code: `0x${string}`;
};

const main = async () => {
  const snapshotPath = process.argv[2];
  const contractCodePath = process.argv[3] ?? new URL('./contract-code.json', import.meta.url);
  if (!snapshotPath) {
    throw new Error(
      'Snapshot file path is required. Usage: tsx examples/stateManager/fromStateSnapshot/create-state-manager.ts <snapshot.json> <contract-code.json>'
    );
  }

  const snapshot: StateSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  const contractCodes: ContractCode[] = JSON.parse(await fs.readFile(contractCodePath, 'utf8'));

  const stateManager = await createTokamakL2StateManagerFromStateSnapshot(snapshot, {
    contractCodes: contractCodes.map((entry) => ({
      address: createAddressFromString(entry.address),
      code: entry.code,
    })),
  });

  const merkleTrees = stateManager.merkleTrees;
  console.log('TokamakL2StateManager created from StateSnapshot.');
  console.log(`Merkle roots: ${merkleTrees.getRoots(snapshot.storageAddresses.map((entry) => createAddressFromString(entry))).map((root) => bigIntToHex(root))}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
