import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const DEFAULT_ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

export const parseHexString = (value: unknown, label: string): `0x${string}` => {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    throw new Error(`${label} must be a hex string with 0x prefix`);
  }
  return value as `0x${string}`;
};

export const parseNumberValue = (value: unknown, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
};

export const parseBigIntValue = (value: unknown, label: string): bigint => {
  if (typeof value === 'string' || typeof value === 'number') {
    return BigInt(value);
  }
  throw new Error(`${label} must be a string or number`);
};

export const assertStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
};

export const assertNumberArray = (value: unknown, label: string): number[] => {
  if (!Array.isArray(value) || !value.every((entry) => Number.isInteger(entry))) {
    throw new Error(`${label} must be an array of integers`);
  }
  return value;
};

export const getRpcUrlFromEnv = (envKey: string): string => {
  dotenv.config({ path: DEFAULT_ENV_PATH });
  const rpcUrl = process.env[envKey];
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    throw new Error(`Environment variable ${envKey} must be set`);
  }
  return rpcUrl;
};
