import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { ChannelStateConfig } from '../../../src/interface/configuration/types.js';

const DEFAULT_ENV_PATH = fileURLToPath(new URL('./.env', import.meta.url));
export const getRpcUrlFromEnv = (envKey: string): string => {
  dotenv.config({ path: DEFAULT_ENV_PATH });
  const rpcUrl = process.env[envKey];
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    throw new Error(`Environment variable ${envKey} must be set`);
  }
  return rpcUrl;
};

export const getRpcUrlForNetwork = (network: ChannelStateConfig['network']): string => {
  const primaryEnvKey = network === 'sepolia' ? 'SEPOLIA_RPC_URL' : 'MAINNET_RPC_URL';
  const fallbackEnvKey = network === 'mainnet' ? 'RPC_URL' : undefined;

  dotenv.config({ path: DEFAULT_ENV_PATH });

  const rpcUrl = process.env[primaryEnvKey] ?? (fallbackEnvKey ? process.env[fallbackEnvKey] : undefined);
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    const supportedKeys = fallbackEnvKey ? `${primaryEnvKey} (preferred) or ${fallbackEnvKey}` : primaryEnvKey;
    throw new Error(`Environment variable ${supportedKeys} must be set for network ${network}`);
  }

  return rpcUrl;
};
