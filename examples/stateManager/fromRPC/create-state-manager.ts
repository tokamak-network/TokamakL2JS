// Usage: tsx examples/create-state-manager.ts <config.json>

import { promises as fs } from 'fs';
import {
  createStateManagerOptsFromChannelConfig,
  createTokamakL2StateManagerFromL1RPC,
  type ChannelErc20TransferTxSimulationConfig,
} from '../../../src/index.js';
import { getRpcUrlFromEnv } from './utils.js';
import { treeNodeToBigint } from '../../../src/stateManager/utils.js';
import { bigIntToHex } from '@ethereumjs/util';

const RPC_URL_ENV_KEY = 'RPC_URL';

const main = async () => {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error('Config file path required. Usage: tsx examples/create-state-manager.ts <config.json>');
  }

  const config: ChannelErc20TransferTxSimulationConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const rpcUrl = getRpcUrlFromEnv(RPC_URL_ENV_KEY);
  const stateManagerOpts = createStateManagerOptsFromChannelConfig(config);

  const stateManager = await createTokamakL2StateManagerFromL1RPC(rpcUrl, stateManagerOpts);
  console.log('TokamakL2StateManager created.');
  console.log(`Merkle roots: ${stateManager.initialMerkleTrees.merkleTrees.map(tree => bigIntToHex(treeNodeToBigint(tree.root)))}`);
};

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
