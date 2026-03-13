import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { ChannelStateConfig } from '../../../src/interface/configuration/types.js';

const DEFAULT_ENV_PATH = fileURLToPath(new URL('./.env', import.meta.url));
const DEFAULT_ANVIL_RPC_URL = 'http://127.0.0.1:8545';
const ANVIL_RPC_URL_ENV_KEY = 'ANVIL_RPC_URL';

export const getRpcUrlForNetwork = (network: ChannelStateConfig['network']): string => {
  dotenv.config({ path: DEFAULT_ENV_PATH });

  if (network === 'anvil') {
    const rpcUrl = process.env[ANVIL_RPC_URL_ENV_KEY]?.trim();
    return rpcUrl && rpcUrl.length > 0 ? rpcUrl : DEFAULT_ANVIL_RPC_URL;
  }

  const alchemyKey = process.env.ALCHEMY_KEY;
  if (typeof alchemyKey !== 'string' || alchemyKey.length === 0) {
    throw new Error('Environment variable ALCHEMY_KEY must be set');
  }

  const networkPath = network === 'sepolia' ? 'eth-sepolia' : 'eth-mainnet';
  return `https://${networkPath}.g.alchemy.com/v2/${alchemyKey}`;
};
