import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { ChannelStateConfig } from '../../../src/interface/configuration/types.js';

const DEFAULT_ENV_PATH = fileURLToPath(new URL('./.env', import.meta.url));

export const getRpcUrlForNetwork = (network: ChannelStateConfig['network']): string => {
  dotenv.config({ path: DEFAULT_ENV_PATH });

  const alchemyKey = process.env.ALCHEMY_KEY;
  if (typeof alchemyKey !== 'string' || alchemyKey.length === 0) {
    throw new Error('Environment variable ALCHEMY_KEY must be set');
  }

  const networkPath = network === 'sepolia' ? 'eth-sepolia' : 'eth-mainnet';
  return `https://${networkPath}.g.alchemy.com/v2/${alchemyKey}`;
};
