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
]
const sameLength = lengths.every((v) => v === lengths[0])
assert(sameLength, 'stateRoots/storageAddresses/registeredKeys length mismatch', failures)

assert(isHexAllowEmpty(snapshot.channelId), 'channelId must be 0x-prefixed hex string', failures)
assert(isHex(snapshot.entryContractAddress), 'entryContractAddress must be hex', failures)
const addressSet = new Set()
for (let i = 0; i < snapshot.storageAddresses.length; i++) {
  const address = snapshot.storageAddresses[i]
  const root = snapshot.stateRoots[i]
  const registered = snapshot.registeredKeys[i]

  assert(isHex(address), `storageAddresses[${i}] must be hex`, failures)
  assert(isHexAllowEmpty(root), `stateRoots[${i}] must be hex`, failures)
  assert(Array.isArray(registered), `registeredKeys[${i}] must be array`, failures)

  const normalizedAddress = String(address).toLowerCase()
  assert(!addressSet.has(normalizedAddress), `duplicate storage address at index ${i}: ${address}`, failures)
  addressSet.add(normalizedAddress)

  for (const [j, entry] of registered.entries()) {
    const ptr = `registeredKeys[${i}][${j}]`
    assert(typeof entry === 'object' && entry !== null, `${ptr} must be object`, failures)
    assert(isHex(entry.key), `${ptr}.key must be hex`, failures)
    assert(isHexAllowEmpty(entry.value), `${ptr}.value must be hex`, failures)
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
