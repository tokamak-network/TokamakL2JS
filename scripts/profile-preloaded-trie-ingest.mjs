import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hrtime } from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  addHexPrefix,
  bytesToBigInt,
  bytesToHex,
  createAddressFromString,
  hexToBytes,
  setLengthLeft,
  bigIntToBytes,
  unpadBytes,
} from '@ethereumjs/util';
import { RLP } from '@ethereumjs/rlp';
import { MerklePatriciaTrie } from '@ethereumjs/mpt';
import { createTokamakL2Common } from '../dist/common/index.js';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(import.meta.dirname, '..');
const paramsFile = path.join(repoRoot, 'src/interface/params/stateManager.ts');

function parseArgs(argv) {
  const options = new Map();
  for (const argument of argv) {
    if (!argument.startsWith('--')) {
      continue;
    }
    const [key, value = 'true'] = argument.slice(2).split('=');
    options.set(key, value);
  }
  return options;
}

function parseInteger(rawValue, fallback, name) {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue)) {
    throw new Error(`Invalid integer for ${name}: ${rawValue}`);
  }
  return parsedValue;
}

function formatSeconds(seconds) {
  return seconds.toFixed(6);
}

function updateDepthInSource(source, depth) {
  const updatedSource = source.replace(/export const MT_DEPTH = \d+;/, `export const MT_DEPTH = ${depth};`);
  if (updatedSource === source) {
    throw new Error('Unable to rewrite MT_DEPTH');
  }
  return updatedSource;
}

async function runCommand(command, args, cwd = repoRoot) {
  await execFileAsync(command, args, { cwd });
}

function measureSync(timings, label, fn) {
  const startedAt = hrtime.bigint();
  try {
    return fn();
  } finally {
    const elapsedSeconds = Number(hrtime.bigint() - startedAt) / 1_000_000_000;
    timings.set(label, (timings.get(label) ?? 0) + elapsedSeconds);
  }
}

async function measureAsync(timings, label, fn) {
  const startedAt = hrtime.bigint();
  try {
    return await fn();
  } finally {
    const elapsedSeconds = Number(hrtime.bigint() - startedAt) / 1_000_000_000;
    timings.set(label, (timings.get(label) ?? 0) + elapsedSeconds);
  }
}

function encodeWord(value) {
  return bytesToHex(setLengthLeft(bigIntToBytes(value), 32));
}

async function importRuntimeModules() {
  const baseUrl = pathToFileURL(`${repoRoot}/dist/`).href;
  const [
    topLevelModule,
    stateManagerModule,
  ] = await Promise.all([
    import(`${baseUrl}index.js`),
    import(`${baseUrl}stateManager/TokamakL2StateManager.js`),
  ]);

  return {
    createTokamakL2StateManagerFromStateSnapshot: topLevelModule.createTokamakL2StateManagerFromStateSnapshot,
    TokamakL2StateManager: stateManagerModule.TokamakL2StateManager,
  };
}

async function buildPreloadedSnapshot(entryCount) {
  const storageAddress = '0x1000000000000000000000000000000000000001';
  const trie = new MerklePatriciaTrie({ useKeyHashing: true, common: createTokamakL2Common() });
  const storageKeys = [];

  for (let index = 0; index < entryCount; index += 1) {
    const key = setLengthLeft(bigIntToBytes(BigInt(index)), 32);
    const value = setLengthLeft(bigIntToBytes(BigInt(index + 1)), 32);
    await trie.put(key, RLP.encode(unpadBytes(value)));
    storageKeys.push(bytesToHex(key));
  }

  const storageTrieDb = Array.from(trie.database().db._database.entries()).map(([key, value]) => ({
    key,
    value: bytesToHex(value),
  }));

  return {
    contractCodes: [
      {
        address: createAddressFromString('0x2000000000000000000000000000000000000002'),
        code: '0x6000',
      },
    ],
    storageAddress,
    storageKeys,
    storageTrieRoots: bytesToHex(trie.root()),
    storageTrieDb,
  };
}

async function warmUpCurrentPath(snapshotLike, createTokamakL2StateManagerFromStateSnapshot) {
  const fakeSnapshot = {
    channelId: 1,
    stateRoots: ['0x' + '00'.repeat(32)],
    storageAddresses: [snapshotLike.storageAddress],
    storageKeys: [snapshotLike.storageKeys],
    storageTrieRoots: [snapshotLike.storageTrieRoots],
    storageTrieDb: [snapshotLike.storageTrieDb.map((entry) => ({
      key: `0x${entry.key}`,
      value: entry.value,
    }))],
  };

  try {
    await createTokamakL2StateManagerFromStateSnapshot(fakeSnapshot, { contractCodes: snapshotLike.contractCodes });
  } catch {
    // The fake state root intentionally mismatches; this warmup is only for module/JIT effects.
  }
}

async function profilePreloadedPath({ payload, TokamakL2StateManager }) {
  const timings = new Map();
  const stateManager = new TokamakL2StateManager({ common: createTokamakL2Common() });
  const storageAddress = createAddressFromString(payload.storageAddress);

  await stateManager._initializeForAddresses([storageAddress]);

  await measureAsync(timings, 'putCodeLoop', async () => {
    for (const codeInfo of payload.contractCodes) {
      await stateManager.putCode(codeInfo.address, hexToBytes(codeInfo.code));
    }
  });

  const account = await stateManager.getAccount(storageAddress);
  if (account === undefined) {
    throw new Error('Expected initialized account');
  }

  await measureAsync(timings, 'ingest.total', async () => {
    const accountTrieDb = stateManager._getAccountTrie().database().db._database;

    measureSync(timings, 'ingest.preloadTrieDb', () => {
      for (const node of payload.storageTrieDb) {
        accountTrieDb.set(node.key, hexToBytes(addHexPrefix(node.value)));
      }
    });

    await measureAsync(timings, 'ingest.applyStorageRootToAccount', async () => {
      account.storageRoot = hexToBytes(addHexPrefix(payload.storageTrieRoots));
      await stateManager.putAccount(storageAddress, account);
    });

    const storageTrie = measureSync(timings, 'ingest.getStorageTrie', () => stateManager._getStorageTrie(storageAddress, account));
    const addressBigInt = measureSync(timings, 'ingest.computeAddressBigInt', () => bytesToBigInt(storageAddress.bytes));
    const storageEntriesForAddress = new Map();
    const keyLeafIndexesForAddress = new Map();
    const leafIndexKeysForAddress = new Map();
    const normalizedEntries = [];

    await measureAsync(timings, 'ingest.readValuesFromTrie', async () => {
      for (const keyHex of payload.storageKeys) {
        const key = hexToBytes(addHexPrefix(keyHex));
        const rawValue = await storageTrie.get(key);
        const decodedValue = rawValue === null ? new Uint8Array() : RLP.decode(rawValue);
        const normalizedValue = unpadBytes(decodedValue);
        const keyBigInt = bytesToBigInt(key);
        const valueBigInt = normalizedValue.length === 0 ? 0n : bytesToBigInt(normalizedValue);
        const leafIndex = stateManager.merkleTrees.constructor.getLeafIndex(keyBigInt);

        storageEntriesForAddress.set(keyBigInt, valueBigInt);
        keyLeafIndexesForAddress.set(keyBigInt, leafIndex);
        leafIndexKeysForAddress.set(leafIndex, keyBigInt);
        normalizedEntries.push({ keyBigInt, valueBigInt });
      }
    });

    measureSync(timings, 'ingest.commitMetadataMaps', () => {
      stateManager.storageEntries.set(addressBigInt, storageEntriesForAddress);
      stateManager._storageKeyLeafIndexes.set(addressBigInt, keyLeafIndexesForAddress);
      stateManager._storageLeafIndexKeys.set(addressBigInt, leafIndexKeysForAddress);
    });

    measureSync(timings, 'ingest.updateMerkleTrees', () => {
      for (const entry of normalizedEntries) {
        stateManager.merkleTrees.update(addressBigInt, entry.keyBigInt, entry.valueBigInt);
      }
    });
  });

  return timings;
}

function renderTable(rows) {
  const header = '| Partition | Seconds | Share of ingest.total |';
  const separator = '| --- | ---: | ---: |';
  const lines = rows.map((row) => `| ${row.label} | ${formatSeconds(row.seconds)} | ${row.share} |`);
  return [header, separator, ...lines].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const depth = parseInteger(options.get('depth'), 30, 'depth');
  const entryCount = parseInteger(options.get('entries'), 4096, 'entries');

  const originalParamsSource = await fs.readFile(paramsFile, 'utf8');
  const originalDepthMatch = originalParamsSource.match(/export const MT_DEPTH = (\d+);/);
  if (!originalDepthMatch) {
    throw new Error('Unable to determine the original MT_DEPTH value');
  }
  const originalDepth = Number.parseInt(originalDepthMatch[1], 10);

  try {
    if (depth !== originalDepth) {
      await fs.writeFile(paramsFile, updateDepthInSource(originalParamsSource, depth));
      await runCommand('npm', ['run', 'build']);
    }

    const runtime = await importRuntimeModules();
    const payload = await buildPreloadedSnapshot(entryCount);

    await warmUpCurrentPath(payload, runtime.createTokamakL2StateManagerFromStateSnapshot);
    const timings = await profilePreloadedPath({
      payload,
      TokamakL2StateManager: runtime.TokamakL2StateManager,
    });

    const ingestTotal = timings.get('ingest.total') ?? 0;
    const rows = Array.from(timings.entries())
      .map(([label, seconds]) => ({
        label,
        seconds,
        share: ingestTotal === 0 ? '0.00%' : `${((seconds / ingestTotal) * 100).toFixed(2)}%`,
      }))
      .sort((left, right) => right.seconds - left.seconds);

    process.stdout.write(
      [
        'Profile target: preloaded storage trie ingest prototype',
        `MT_DEPTH=${depth}, storageEntries=${entryCount}`,
        '',
        renderTable(rows),
        '',
        JSON.stringify({ depth, entryCount, ingestTotalSeconds: ingestTotal, partitions: rows }, null, 2),
        '',
      ].join('\n')
    );
  } finally {
    if (depth !== originalDepth) {
      await fs.writeFile(paramsFile, originalParamsSource);
      await runCommand('npm', ['run', 'build']);
    }
  }
}

await main();
