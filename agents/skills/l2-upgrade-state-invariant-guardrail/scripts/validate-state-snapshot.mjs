#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const snapshotPath = process.argv[2]
if (!snapshotPath) {
  console.error('Usage: node validate-state-snapshot.mjs <snapshot.json>')
  process.exit(1)
}

const isHex = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)
const isHexAllowEmpty = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v)

const assert = (cond, msg, failures) => {
  if (!cond) failures.push(msg)
}

let snapshot
try {
  snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
} catch (err) {
  console.error(`Failed to parse snapshot file: ${snapshotPath}`)
  console.error(String(err))
  process.exit(1)
}

const failures = []

assert(typeof snapshot === 'object' && snapshot !== null, 'Snapshot must be an object', failures)
assert(typeof snapshot.channelId === 'string', 'channelId must be a string', failures)
assert(Array.isArray(snapshot.stateRoots), 'stateRoots must be an array', failures)
assert(Array.isArray(snapshot.storageAddresses), 'storageAddresses must be an array', failures)
assert(Array.isArray(snapshot.registeredKeys), 'registeredKeys must be an array', failures)
assert(Array.isArray(snapshot.storageEntries), 'storageEntries must be an array', failures)
assert(Array.isArray(snapshot.preAllocatedLeaves), 'preAllocatedLeaves must be an array', failures)
assert(typeof snapshot.entryContractAddress === 'string', 'entryContractAddress must be a string', failures)

if (failures.length > 0) {
  console.error('Snapshot validation failed:')
  for (const f of failures) console.error(`- ${f}`)
  process.exit(2)
}

const lengths = [
  snapshot.stateRoots.length,
  snapshot.storageAddresses.length,
  snapshot.registeredKeys.length,
  snapshot.storageEntries.length,
  snapshot.preAllocatedLeaves.length,
]
const sameLength = lengths.every((v) => v === lengths[0])
assert(sameLength, 'stateRoots/storageAddresses/registeredKeys/storageEntries/preAllocatedLeaves length mismatch', failures)

assert(isHexAllowEmpty(snapshot.channelId), 'channelId must be 0x-prefixed hex string', failures)
assert(isHex(snapshot.entryContractAddress), 'entryContractAddress must be 0x-prefixed non-empty hex string', failures)

const addressSet = new Set()
for (let i = 0; i < snapshot.storageAddresses.length; i++) {
  const address = snapshot.storageAddresses[i]
  const root = snapshot.stateRoots[i]
  const registered = snapshot.registeredKeys[i]
  const storageEntries = snapshot.storageEntries[i]
  const preAllocated = snapshot.preAllocatedLeaves[i]

  assert(isHex(address), `storageAddresses[${i}] must be hex`, failures)
  assert(isHexAllowEmpty(root), `stateRoots[${i}] must be hex`, failures)
  assert(Array.isArray(registered), `registeredKeys[${i}] must be array`, failures)
  assert(Array.isArray(storageEntries), `storageEntries[${i}] must be array`, failures)
  assert(Array.isArray(preAllocated), `preAllocatedLeaves[${i}] must be array`, failures)

  const normalizedAddress = String(address).toLowerCase()
  assert(!addressSet.has(normalizedAddress), `duplicate storage address at index ${i}: ${address}`, failures)
  addressSet.add(normalizedAddress)

  const regSet = new Set()
  for (const [k, key] of registered.entries()) {
    assert(isHex(key), `registeredKeys[${i}][${k}] must be hex`, failures)
    regSet.add(String(key).toLowerCase())
  }

  const unionSet = new Set()
  const keyValueLists = [
    ['storageEntries', storageEntries],
    ['preAllocatedLeaves', preAllocated],
  ]
  for (const [label, entries] of keyValueLists) {
    for (const [j, entry] of entries.entries()) {
      const ptr = `${label}[${i}][${j}]`
      assert(typeof entry === 'object' && entry !== null, `${ptr} must be object`, failures)
      assert(isHex(entry.key), `${ptr}.key must be hex`, failures)
      assert(isHexAllowEmpty(entry.value), `${ptr}.value must be hex`, failures)
      if (entry && typeof entry.key === 'string') {
        unionSet.add(entry.key.toLowerCase())
      }
    }
  }

  if (regSet.size !== unionSet.size) {
    failures.push(`registered key count mismatch at address index ${i}: registered=${regSet.size}, union=${unionSet.size}`)
  }
  for (const key of unionSet) {
    if (!regSet.has(key)) {
      failures.push(`registered keys missing entry key at address index ${i}: ${key}`)
    }
  }
  for (const key of regSet) {
    if (!unionSet.has(key)) {
      failures.push(`registered keys contain extra key at address index ${i}: ${key}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Snapshot validation failed:')
  for (const f of failures) console.error(`- ${f}`)
  process.exit(2)
}

console.log(`Snapshot validation passed: ${snapshotPath}`)
console.log(`- addresses: ${snapshot.storageAddresses.length}`)
console.log(`- roots: ${snapshot.stateRoots.length}`)
