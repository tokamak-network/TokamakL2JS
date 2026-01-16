import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const DEFAULT_ENV_PATH = fileURLToPath(new URL('./.env', import.meta.url));
export const getRpcUrlFromEnv = (envKey: string): string => {
  dotenv.config({ path: DEFAULT_ENV_PATH });
  const rpcUrl = process.env[envKey];
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    throw new Error(`Environment variable ${envKey} must be set`);
  }
  return rpcUrl;
};