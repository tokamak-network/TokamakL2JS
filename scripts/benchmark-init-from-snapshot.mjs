import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { hrtime } from 'node:process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  bigIntToBytes,
  bigIntToHex,
  bytesToHex,
  createAddressFromString,
  setLengthLeft,
} from '@ethereumjs/util';
import { jubjub } from '@noble/curves/misc';
import { IMT } from '@zk-kit/imt';
import { poseidon2 } from 'poseidon-bls12381';

const execFileAsync = promisify(execFile);
const POSEIDON_INPUTS = 2;
const NULL_LEAF = 0n;
const DEFAULT_DEPTHS = [8, 10, 12, 14];
const DEFAULT_ENTRY_COUNTS = [1, 32, 256, 1024, 2048, 4096];
const DEFAULT_REPEATS = 5;
const DEFAULT_WARMUP = 1;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const paramsFile = path.join(repoRoot, 'src/interface/params/stateManager.ts');
const distEntry = path.join(repoRoot, 'dist/index.js');

function parseArgs(argv) {
  const options = new Map();
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const eqIndex = arg.indexOf('=');
    if (eqIndex === -1) {
      options.set(arg.slice(2), 'true');
      continue;
    }
    options.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
  }
  return options;
}

function parseIntegerList(rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }
  const values = rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => Number.parseInt(entry, 10));
  if (values.length === 0 || values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error(`Expected a comma-separated list of positive integers, but got "${rawValue}"`);
  }
  return values;
}

function parseInteger(rawValue, fallback, label) {
  if (!rawValue) {
    return fallback;
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer, but got "${rawValue}"`);
  }
  return value;
}

function formatMs(value) {
  return value.toFixed(3);
}

function getSummary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    avgMs: total / sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function renderTable(rows) {
  const lines = [
    '| MT_DEPTH | MAX_MT_LEAVES | storageEntries | repeats | avg ms | min ms | max ms | note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.depth} | ${row.maxLeaves} | ${row.entryCount} | ${row.repeats} | ${row.avgMs ?? '-'} | ${row.minMs ?? '-'} | ${row.maxMs ?? '-'} | ${row.note} |`
    );
  }

  return lines.join('\n');
}

async function runCommand(file, args, options = {}) {
  return execFileAsync(file, args, {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function updateDepthInSource(source, depth) {
  const pattern = /export const MT_DEPTH = \d+;/;
  if (!pattern.test(source)) {
    throw new Error('Unable to locate MT_DEPTH declaration in src/interface/params/stateManager.ts');
  }
  return source.replace(pattern, `export const MT_DEPTH = ${depth};`);
}

function poseidonRaw(inputs) {
  if (inputs.length !== POSEIDON_INPUTS) {
    throw new Error(`Expected ${POSEIDON_INPUTS} Poseidon inputs, but got ${inputs.length}`);
  }
  return poseidon2(inputs);
}

function treeNodeToBigint(node) {
  if (typeof node === 'bigint') {
    return node;
  }
  if (typeof node === 'string') {
    return BigInt(node.startsWith('0x') ? node : `0x${node}`);
  }
  return BigInt(node);
}

function encodeWord(value) {
  return bytesToHex(setLengthLeft(bigIntToBytes(value), 32));
}

function buildSnapshot(depth, entryCount) {
  const maxLeaves = POSEIDON_INPUTS ** depth;
  if (entryCount > maxLeaves) {
    throw new Error(`entryCount ${entryCount} exceeds MAX_MT_LEAVES ${maxLeaves} for MT_DEPTH ${depth}`);
  }

  const storageAddress = '0x1000000000000000000000000000000000000001';
  const tree = new IMT(
    poseidonRaw,
    depth,
    NULL_LEAF,
    POSEIDON_INPUTS,
    Array(maxLeaves).fill(NULL_LEAF)
  );
  const storageEntries = [];

  for (let index = 0; index < entryCount; index += 1) {
    const key = BigInt(index);
    const value = BigInt(index + 1);
    const leafIndex = Number(key % BigInt(maxLeaves));
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

async function runWorker(options) {
  const depth = parseInteger(options.get('depth'), null, 'depth');
  const entryCount = parseInteger(options.get('entries'), null, 'entries');
  const repeats = parseInteger(options.get('repeats'), DEFAULT_REPEATS, 'repeats');
  const warmup = parseInteger(options.get('warmup'), DEFAULT_WARMUP, 'warmup');

  if (depth === null || entryCount === null) {
    throw new Error('Worker mode requires --depth and --entries');
  }

  const moduleUrl = `${pathToFileURL(distEntry).href}?worker=${Date.now()}-${Math.random()}`;
  const { createTokamakL2StateManagerFromStateSnapshot } = await import(moduleUrl);
  const { snapshot, contractCodes } = buildSnapshot(depth, entryCount);

  for (let round = 0; round < warmup; round += 1) {
    await createTokamakL2StateManagerFromStateSnapshot(snapshot, { contractCodes });
  }

  const timingsMs = [];
  for (let round = 0; round < repeats; round += 1) {
    const startedAt = hrtime.bigint();
    await createTokamakL2StateManagerFromStateSnapshot(snapshot, { contractCodes });
    const elapsedMs = Number(hrtime.bigint() - startedAt) / 1_000_000;
    timingsMs.push(elapsedMs);
  }

  process.stdout.write(
    `${JSON.stringify({
      depth,
      entryCount,
      repeats,
      warmup,
      timingsMs,
    })}\n`
  );
}

async function runMain(options) {
  const depths = parseIntegerList(options.get('depths'), DEFAULT_DEPTHS);
  const entryCounts = parseIntegerList(options.get('entryCounts'), DEFAULT_ENTRY_COUNTS);
  const repeats = parseInteger(options.get('repeats'), DEFAULT_REPEATS, 'repeats');
  const warmup = parseInteger(options.get('warmup'), DEFAULT_WARMUP, 'warmup');

  const originalParamsSource = await fs.readFile(paramsFile, 'utf8');
  const originalDepthMatch = originalParamsSource.match(/export const MT_DEPTH = (\d+);/);
  if (!originalDepthMatch) {
    throw new Error('Unable to determine the original MT_DEPTH value');
  }

  const originalDepth = Number.parseInt(originalDepthMatch[1], 10);
  const rows = [];

  try {
    for (const depth of depths) {
      const updatedSource = updateDepthInSource(originalParamsSource, depth);
      await fs.writeFile(paramsFile, updatedSource);
      await runCommand('npm', ['run', 'build']);

      const maxLeaves = POSEIDON_INPUTS ** depth;
      for (const entryCount of entryCounts) {
        if (entryCount > maxLeaves) {
          rows.push({
            depth,
            maxLeaves,
            entryCount,
            repeats,
            note: 'skipped: entryCount exceeds MAX_MT_LEAVES',
          });
          continue;
        }

        const { stdout } = await runCommand(process.execPath, [
          scriptPath,
          '--worker',
          `--depth=${depth}`,
          `--entries=${entryCount}`,
          `--repeats=${repeats}`,
          `--warmup=${warmup}`,
        ]);
        const measurement = JSON.parse(stdout.trim());
        const summary = getSummary(measurement.timingsMs);
        rows.push({
          depth,
          maxLeaves,
          entryCount,
          repeats,
          avgMs: formatMs(summary.avgMs),
          minMs: formatMs(summary.minMs),
          maxMs: formatMs(summary.maxMs),
          note: `warmup ${warmup}`,
        });
      }
    }
  } finally {
    await fs.writeFile(paramsFile, originalParamsSource);
    if (depths.some((depth) => depth !== originalDepth)) {
      await runCommand('npm', ['run', 'build']);
    }
  }

  process.stdout.write(
    [
      'Benchmark target: createTokamakL2StateManagerFromStateSnapshot',
      'Measured scope: initTokamakExtendsFromSnapshot path only; build time excluded.',
      'Synthetic snapshot shape: 1 storage address, 1 contract code entry, unique storage keys, non-zero 32-byte values.',
      '',
      renderTable(rows),
      '',
      JSON.stringify({ depths, entryCounts, repeats, warmup, rows }, null, 2),
      '',
    ].join('\n')
  );
}

const options = parseArgs(process.argv.slice(2));

if (options.has('worker')) {
  await runWorker(options);
} else {
  await runMain(options);
}
