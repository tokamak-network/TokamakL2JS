import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hrtime } from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  addHexPrefix,
  bigIntToBytes,
  bigIntToHex,
  bytesToBigInt,
  bytesToHex,
  createAddressFromString,
  hexToBigInt,
  hexToBytes,
  setLengthLeft,
  unpadBytes,
} from '@ethereumjs/util';
import { RLP } from '@ethereumjs/rlp';
import { jubjub } from '@noble/curves/misc';

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

function encodeWord(value) {
  return bytesToHex(setLengthLeft(bigIntToBytes(value), 32));
}

function formatSeconds(seconds) {
  return seconds.toFixed(6);
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

async function runCommand(command, args, cwd = repoRoot) {
  await execFileAsync(command, args, { cwd });
}

function updateDepthInSource(source, depth) {
  const updatedSource = source.replace(/export const MT_DEPTH = \d+;/, `export const MT_DEPTH = ${depth};`);
  if (updatedSource === source) {
    throw new Error('Unable to rewrite MT_DEPTH');
  }
  return updatedSource;
}

async function importProfileModules() {
  const baseUrl = pathToFileURL(`${repoRoot}/dist/`).href;
  const [
    stateManagerModule,
    merkleModule,
    cryptoModule,
    stateManagerParamsModule,
    cryptoParamsModule,
    utilsModule,
  ] = await Promise.all([
    import(`${baseUrl}stateManager/TokamakL2StateManager.js`),
    import(`${baseUrl}stateManager/TokamakMerkleTrees.js`),
    import(`${baseUrl}crypto/index.js`),
    import(`${baseUrl}interface/params/stateManager.js`),
    import(`${baseUrl}interface/params/crypto.js`),
    import(`${baseUrl}stateManager/utils.js`),
  ]);

  const topLevelModule = await import(`${baseUrl}index.js`);

  return {
    createTokamakL2StateManagerFromStateSnapshot: topLevelModule.createTokamakL2StateManagerFromStateSnapshot,
    TokamakL2StateManager: stateManagerModule.TokamakL2StateManager,
    TokamakSparseMerkleTree: merkleModule.TokamakSparseMerkleTree,
    TokamakL2MerkleTrees: merkleModule.TokamakL2MerkleTrees,
    poseidon_raw: cryptoModule.poseidon_raw,
    NULL_LEAF: stateManagerParamsModule.NULL_LEAF,
    POSEIDON_INPUTS: cryptoParamsModule.POSEIDON_INPUTS,
    treeNodeToBigint: utilsModule.treeNodeToBigint,
    assertSnapshotStorageShape: utilsModule.assertSnapshotStorageShape,
    assertStorageEntryCapacity: utilsModule.assertStorageEntryCapacity,
  };
}

function buildSnapshot({ depth, entryCount, TokamakSparseMerkleTree, poseidon_raw, NULL_LEAF, POSEIDON_INPUTS, treeNodeToBigint }) {
  const storageAddress = '0x1000000000000000000000000000000000000001';
  const tree = new TokamakSparseMerkleTree(poseidon_raw, depth, NULL_LEAF, POSEIDON_INPUTS);
  const storageEntries = [];

  for (let index = 0; index < entryCount; index += 1) {
    const key = BigInt(index);
    const value = BigInt(index + 1);
    const leafIndex = Number(key % BigInt(POSEIDON_INPUTS ** depth));
    const leaf = value % jubjub.Point.Fp.ORDER;
    tree.update(leafIndex, leaf);
    storageEntries.push({
      key: encodeWord(key),
      value: encodeWord(value),
    });
  }

  return {
    snapshot: {
      channelId: 1,
      stateRoots: [bigIntToHex(treeNodeToBigint(tree.root))],
      storageAddresses: [storageAddress],
      storageEntries: [storageEntries],
    },
    contractCodes: [
      {
        address: createAddressFromString('0x2000000000000000000000000000000000000002'),
        code: '0x6000',
      },
    ],
  };
}

function installProfiler({ timings, TokamakL2StateManager, TokamakL2MerkleTrees, assertSnapshotStorageShape, assertStorageEntryCapacity }) {
  const prototype = TokamakL2StateManager.prototype;
  const originals = {
    initTokamakExtendsFromSnapshot: prototype.initTokamakExtendsFromSnapshot,
    _initializeForAddresses: prototype._initializeForAddresses,
    _ingestStorageEntries: prototype._ingestStorageEntries,
    _openAccount: prototype._openAccount,
    putCode: prototype.putCode,
    flush: prototype.flush,
  };

  prototype._openAccount = async function patchedOpenAccount(address) {
    return measureAsync(timings, 'initialize.openAccount', () => originals._openAccount.call(this, address));
  };

  prototype.putCode = async function patchedPutCode(address, code) {
    return measureAsync(timings, 'snapshot.putCode.item', () => originals.putCode.call(this, address, code));
  };

  prototype.flush = async function patchedFlush(...args) {
    return measureAsync(timings, 'snapshot.flush', () => originals.flush.apply(this, args));
  };

  prototype._initializeForAddresses = async function patchedInitializeForAddresses(addresses) {
    return measureAsync(timings, 'initialize.total', async () => {
      measureSync(timings, 'initialize.guard', () => {
        if (this._storageEntries !== null || this._storageAddresses !== null || this._merkleTrees !== null || this._storageKeyLeafIndexes !== null || this._storageLeafIndexKeys !== null) {
          throw new Error('TokamakL2StateManager cannot be initialized twice');
        }
      });

      measureSync(timings, 'initialize.assignAddresses', () => {
        this._storageAddresses = addresses;
      });

      measureSync(timings, 'initialize.constructMerkleTrees', () => {
        this._merkleTrees = new TokamakL2MerkleTrees(addresses);
      });

      measureSync(timings, 'initialize.createMaps', () => {
        this._storageEntries = new Map();
        this._storageKeyLeafIndexes = new Map();
        this._storageLeafIndexKeys = new Map();
      });

      await measureAsync(timings, 'initialize.openAccounts', async () => {
        await Promise.all(addresses.map((address) => this._openAccount(address)));
      });
    });
  };

  prototype._ingestStorageEntries = async function patchedIngestStorageEntries(address, entries) {
    return measureAsync(timings, 'ingest.total', async () => {
      measureSync(timings, 'ingest.guardChecks', () => {
        if (this._storageEntries === null) {
          throw new Error('Storage entries are not initialized');
        }
        if (this._storageKeyLeafIndexes === null) {
          throw new Error('Storage key leaf indexes are not initialized');
        }
        if (this._storageLeafIndexKeys === null) {
          throw new Error('Storage leaf index keys are not initialized');
        }
      });

      const merkleTrees = measureSync(timings, 'ingest.getMerkleTrees', () => this._getMerkleTrees());
      const account = await measureAsync(timings, 'ingest.getAccount', () => this.getAccount(address));
      if (account === undefined) {
        throw new Error(`Cannot initialize storage for missing account ${address.toString()}`);
      }

      const addressBigInt = measureSync(timings, 'ingest.computeAddressBigInt', () => bytesToBigInt(address.bytes));
      const storageEntriesForAddress = new Map();
      const keyLeafIndexesForAddress = new Map();
      const leafIndexKeysForAddress = new Map();
      const normalizedEntries = [];

      measureSync(timings, 'ingest.normalizeValidate', () => {
        for (const entry of entries) {
          const keyBigInt = bytesToBigInt(entry.key);
          if (keyLeafIndexesForAddress.has(keyBigInt)) {
            throw new Error('Duplication in L2 MPT keys.');
          }
          const leafIndex = TokamakL2MerkleTrees.getLeafIndex(keyBigInt);
          const conflictingKey = leafIndexKeysForAddress.get(leafIndex);
          if (conflictingKey !== undefined && conflictingKey !== keyBigInt) {
            throw new Error(`Leaf index collision for address ${address.toString()}: storage key ${keyBigInt.toString()} conflicts with storage key ${conflictingKey.toString()} at leaf index ${leafIndex}`);
          }

          const normalizedValue = unpadBytes(entry.value);
          const valueBigInt = normalizedValue.length === 0 ? 0n : bytesToBigInt(normalizedValue);
          normalizedEntries.push({
            key: entry.key,
            value: normalizedValue,
            keyBigInt,
            valueBigInt,
          });
          storageEntriesForAddress.set(keyBigInt, valueBigInt);
          keyLeafIndexesForAddress.set(keyBigInt, leafIndex);
          leafIndexKeysForAddress.set(leafIndex, keyBigInt);
        }
      });

      await measureAsync(timings, 'ingest.modifyContractStorage', async () => {
        await this._modifyContractStorage(address, account, async (storageTrie, done) => {
          await measureAsync(timings, 'ingest.storageTrieWrites', async () => {
            for (const entry of normalizedEntries) {
              if (entry.value.length === 0) {
                await storageTrie.del(entry.key);
              } else {
                await storageTrie.put(entry.key, RLP.encode(entry.value));
              }
            }
          });

          measureSync(timings, 'ingest.modifyContractStorage.done', () => {
            done();
          });
        });
      });

      measureSync(timings, 'ingest.commitMetadataMaps', () => {
        this._storageEntries.set(addressBigInt, storageEntriesForAddress);
        this._storageKeyLeafIndexes.set(addressBigInt, keyLeafIndexesForAddress);
        this._storageLeafIndexKeys.set(addressBigInt, leafIndexKeysForAddress);
      });

      measureSync(timings, 'ingest.updateMerkleTrees', () => {
        for (const entry of normalizedEntries) {
          merkleTrees.update(addressBigInt, entry.keyBigInt, entry.valueBigInt);
        }
      });
    });
  };

  prototype.initTokamakExtendsFromSnapshot = async function patchedInitFromSnapshot(snapshot, opts) {
    return measureAsync(timings, 'snapshot.total', async () => {
      measureSync(timings, 'snapshot.assertShape', () => {
        assertSnapshotStorageShape(snapshot);
      });

      measureSync(timings, 'snapshot.assignChannelId', () => {
        this._channelId = snapshot.channelId;
      });

      const storageAddresses = measureSync(timings, 'snapshot.decodeStorageAddresses', () =>
        snapshot.storageAddresses.map((address) => createAddressFromString(address))
      );

      await measureAsync(timings, 'snapshot.initializeForAddresses', () => this._initializeForAddresses(storageAddresses));

      await measureAsync(timings, 'snapshot.putCodeLoop', async () => {
        for (const codeInfo of opts.contractCodes) {
          await this.putCode(codeInfo.address, hexToBytes(codeInfo.code));
        }
      });

      await measureAsync(timings, 'snapshot.storageLoop', async () => {
        for (const [index, addressString] of snapshot.storageAddresses.entries()) {
          measureSync(timings, 'snapshot.assertStorageCapacity', () => {
            assertStorageEntryCapacity(snapshot.storageEntries[index].length, addressString);
          });

          const address = measureSync(timings, 'snapshot.decodeStorageAddress', () => createAddressFromString(addressString));
          const decodedEntries = measureSync(timings, 'snapshot.decodeStorageEntries', () =>
            snapshot.storageEntries[index].map((entry) => ({
              key: hexToBytes(addHexPrefix(entry.key)),
              value: hexToBytes(addHexPrefix(entry.value)),
            }))
          );
          await this._ingestStorageEntries(address, decodedEntries);
        }
      });

      await this.flush();

      const roots = measureSync(timings, 'snapshot.getRoots', () => this._getMerkleTrees().getRoots(storageAddresses));

      measureSync(timings, 'snapshot.verifyRoots', () => {
        for (const [index, addressString] of snapshot.storageAddresses.entries()) {
          if (roots[index] === undefined) {
            throw new Error(`Merkle tree is not registered for the address ${addressString}`);
          }
          if (roots[index] !== hexToBigInt(addHexPrefix(snapshot.stateRoots[index]))) {
            throw new Error(`Creating TokamakL2StateManager using StateSnapshot fails: (provided root: ${snapshot.stateRoots[index]}, reconstructed root: ${bigIntToHex(roots[index])}) for storage ${addressString} at index ${index}`);
          }
        }
      });
    });
  };

  return () => {
    prototype.initTokamakExtendsFromSnapshot = originals.initTokamakExtendsFromSnapshot;
    prototype._initializeForAddresses = originals._initializeForAddresses;
    prototype._ingestStorageEntries = originals._ingestStorageEntries;
    prototype._openAccount = originals._openAccount;
    prototype.putCode = originals.putCode;
    prototype.flush = originals.flush;
  };
}

function renderTable(rows) {
  const header = '| Partition | Seconds | Share |';
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

    const modules = await importProfileModules();
    const { snapshot, contractCodes } = buildSnapshot({
      depth,
      entryCount,
      TokamakSparseMerkleTree: modules.TokamakSparseMerkleTree,
      poseidon_raw: modules.poseidon_raw,
      NULL_LEAF: modules.NULL_LEAF,
      POSEIDON_INPUTS: modules.POSEIDON_INPUTS,
      treeNodeToBigint: modules.treeNodeToBigint,
    });

    const timings = new Map();
    const restoreProfiler = installProfiler({
      timings,
      TokamakL2StateManager: modules.TokamakL2StateManager,
      TokamakL2MerkleTrees: modules.TokamakL2MerkleTrees,
      assertSnapshotStorageShape: modules.assertSnapshotStorageShape,
      assertStorageEntryCapacity: modules.assertStorageEntryCapacity,
    });

    try {
      await modules.createTokamakL2StateManagerFromStateSnapshot(snapshot, { contractCodes });
    } finally {
      restoreProfiler();
    }

    const total = timings.get('snapshot.total') ?? 0;
    const rows = Array.from(timings.entries())
      .map(([label, seconds]) => ({
        label,
        seconds,
        share: total === 0 ? '0.00%' : `${((seconds / total) * 100).toFixed(2)}%`,
      }))
      .sort((left, right) => right.seconds - left.seconds);

    process.stdout.write(
      [
        `Profile target: initTokamakExtendsFromSnapshot`,
        `MT_DEPTH=${depth}, storageEntries=${entryCount}`,
        '',
        renderTable(rows),
        '',
        JSON.stringify({ depth, entryCount, totalSeconds: total, partitions: rows }, null, 2),
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
